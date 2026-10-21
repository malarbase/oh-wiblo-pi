# Edit Tool: Gaps and Misbehaviour During Multi-Edit Sessions

## Symptom

During a session with 5+ sequential edits to the same file, the agent encountered repeated friction:

1. Parameter format confusion (named params vs hashline `input` string)
2. Stale-tag re-read tax after every edit
3. No block-insert operation (must replace entire ranges to add one line)
4. Flaky `todo_write` serialization on first call
5. Silent sibling-content loss during structural edits (see Issue 5)

During a subsequent session with **30+ sequential edits** across two YAML HelmRelease files, a more severe variant of issue 5 dominated:

6. Silent loss of adjacent YAML siblings when replacing a range inside a mapping (see Issue 5)
7. No preview/dry-run — every edit applies immediately, corruption cascades
8. Duplicate lines injected when edit body overlaps with untouched adjacent lines

## Issue 1: Parameter Schema Mismatch

The tool's **system prompt** (visible to the agent via the tool description) exposes replace/patch mode schemas with named parameters:

```
{
  "path": "src/foo.ts",
  "edit": "replace N..N:",
  "oldText": "...",
  "newText": "..."
}
```

But the **actual default schema** is hashline mode, which accepts only:

```typescript
z.object({ input: z.string() }).passthrough()
```

The agent (Claude) sees the named-parameter schema in the tool description and attempts to use it. The tool rejects it silently — the `passthrough()` swallows unknown keys, but `input` is required and absent, so the call either fails or gets misrouted.

**Root cause**: `EditTool.parameters` is resolved dynamically per edit mode at runtime. The tool description exposed to the agent in the system prompt reflects one mode (replace/patch), but the actual execution defaults to hashline. The `input` field is the only one that matters, yet the agent never sees it described.

**Evidence from session**:
```
edit: Invalid input: expected string, received undefined
Received arguments: {
  "edit": "replace 57..65:",
  "path": "...",
  "oldText": "...",
  "newText": "..."
}
```

The agent had to be told explicitly to use `input: "¶PATH#TAG\nreplace N..N:\n+body"` format.

### Proposed fix

The tool description exposed to the agent (the `description` field sent to the model) should always describe the hashline format as the primary interface, regardless of which edit mode is configured. The named-parameter schemas should be documented only in the mode-specific sub-descriptions (which are appended conditionally).

Alternatively, make the tool accept named parameters directly by mapping `path` + `oldText` + `newText` to hashline format internally, so both interfaces work.

## Issue 2: Stale-Tag Re-read Tax

Every applied edit mints a fresh `#TAG` and renumbers lines. The next edit MUST use the new tag and line numbers, which means:

1. Edit response returns new tag + line numbers
2. Agent must parse the response to extract them
3. Agent must construct the next edit using those values
4. If anything goes wrong, agent must `read` the file again (full context reload)

For a 5-edit session on a 100-line file, this costs:
- 5 edit responses (with new tags)
- 3-5 re-reads (when agent can't parse the response, or when edits span different sections)
- Total: ~1500-2500 extra tokens per file

**Why it matters**: Multi-edit sessions are common (add a section, fix a table, update references). The re-read tax makes them 2-3x more expensive than they need to be.

### Proposed fix

Return the **new tag and a line-number mapping** (old→new) in every edit response. The agent can then anchor subsequent edits without re-reading. Example response:

```
¶PATH#NEW_TAG
[edit applied]
Line mapping: {57→57, 58→58, ..., 65→66}  // one line inserted, shifted by 1
```

This is safe because the edit tool already computes the diff internally — the line mapping is a byproduct.

## Issue 3: No Block-Insert Operation

The tool has:
- `insert before N:` — insert before line N
- `insert after N:` — insert after line N
- `replace block N:` — replace entire syntactic block starting at line N

But there's no **insert-at-end-of-block** or **insert-at-position-within-block**. To add a new row to a YAML table or a new entry to a failure table, the agent must:

1. Identify the last line of the target section (requires reading the file)
2. `replace` that line plus the new content (fragile — must include the unchanged line)

This is error-prone for structured content like YAML or markdown tables where the "last line" varies.

### Proposed fix

Add `insert before block N:` and `insert after block N:` — resolves the syntactic block at line N, then inserts before/after the block's boundaries. This lets the agent say "add a new row after the end of this table" without manually counting lines.

Alternatively, support `insert after N:` where N is the last line of a section, and the tool validates that N is a valid insertion point (not mid-expression).

## Issue 4: `todo_write` Flaky Serialization

First call to `todo_write` failed with:

```
Validation failed for tool "todo_write":
  - ops/0: Invalid input: expected object, received string
```

The agent passed `ops` as a JSON array (correct per the schema), but the tool received it as a JSON **string** (the array was serialized to a string before reaching the validator). Identical structure succeeded on retry.

**Likely cause**: The tool-call serialization layer sometimes double-serializes array parameters. This is intermittent — works 80% of the time, fails on first attempt 20%.

### Proposed fix

Add defensive deserialization in the tool's execute path: if `ops` is a string, attempt `JSON.parse()` before validation. This is a band-aid; the real fix is in the tool-call serialization layer.


## Issue 5: Silent Sibling-Content Loss During YAML Range Replacement

When replacing a range of lines inside a YAML mapping (e.g., replacing the `env:` section of a HelmRelease), the tool correctly replaces the specified lines but **silently drops adjacent siblings** that were not part of the range.

**Example** — the file has:
```yaml
          containers:
            main:
              env:                    # line 79
                KEY: value            # line 80
    service:                          # line 81
      main:                           # line 82
        type: LoadBalancer            # line 83
```

Agent issues `replace 79..80:` with new env content. Result:
```yaml
          containers:
            main:
              env:
                NEW_KEY: new_value
```

Lines 81–83 (`service:` block) are **gone**. The tool reports success; the agent doesn't notice until a downstream build or deploy fails.

**Root cause**: The agent specifies the range correctly, but the replacement body sometimes omits trailing lines that the agent assumed would survive. The tool has no structural awareness — it replaces exactly the byte range between the specified lines. If the agent's mental model of "what's on the boundary lines" is wrong (common after multiple edits without re-reading), the replacement body is incomplete.

This is fundamentally an **agent error** (incorrect range specification), but the tool could mitigate it.

**Compounding factor**: After a stale-tag re-read, the agent constructs the replacement body from the *new* line numbers but sometimes includes lines from the *old* read in its mental model. The result is a replacement body that's a mix of old and new content — structurally valid YAML but with missing siblings.

**Evidence from session**: In a 30-edit session on `clusters/whiteblossom/base/lldap.yaml`, this occurred at least 5 times:
* `service: main:` wrapper dropped when replacing `env:` section
* `containers: main:` wrapper dropped, causing `env:` to appear at the wrong YAML depth
* `postRenderers:` section lost values when replacing `cnpg:` values
* Duplicate `ingress:` line created when replacement body included a line that already existed below the range

### Proposed fix

**Defensive**: Before applying a `replace N..M:` in a file with structured content (YAML, JSON, TOML), the tool could warn if the replacement body changes the indentation depth relative to the surrounding lines. This catches the most common failure mode (dropping a parent wrapper).

**Structural**: Add a YAML/JSON-aware edit mode where the agent specifies a *path* instead of line numbers (e.g., `replace path: spec.values.workload.main.podSpec.containers.main.env`). The tool resolves the line range from the structural path, guaranteeing the range boundaries are correct.

**Cheap mitigation**: Return the **surrounding context** (3 lines before and after the replaced range) in the edit response. This lets the agent verify the structural integrity without a full re-read.

## Issue 6: No Preview / Cascading Corruption

The edit tool applies immediately with no undo. When an edit corrupts the file (Issue 5), the next edit is constructed against the corrupted state. If the agent does not re-read after every edit, corruption compounds:

1. Edit 1: Replaces lines 79–80, accidentally drops `service:` block (lines 81–83)
2. Edit 2: Targets line 83 (which is now a completely different line)
3. Edit 3: Completely wrong content applied to wrong location

By edit 3–4, the file is unrecoverable and the agent must `git checkout` or re-read plus manually reconstruct.

**Evidence**: In the session, this cascade happened three times. Each time, the agent spent 3–5 edit cycles (plus re-reads) recovering from the corruption — roughly 10–15 tool calls to undo what 1 bad edit caused.

### Proposed fix

Add a `preview` mode to the edit tool: `edit(path, input, preview=true)` returns the would-be result without writing to disk. The agent can then verify and apply in a second call. This doubles the tool calls for each edit but eliminates cascading corruption.

Alternatively, add an `undo` command that reverts the last edit (the tool already has the pre-edit state from the tag snapshot).

## Affected Files

- `packages/coding-agent/src/edit/index.ts` — EditTool class, schema resolution
- `packages/coding-agent/src/edit/hashline/params.ts` — hashline schema (permissive passthrough)
- `packages/coding-agent/src/edit/prompt.md` — hashline format documentation
- `packages/coding-agent/src/prompts/tools/` — per-mode description files (replace.md, patch.md)
- `packages/coding-agent/src/tools/todo-write.ts` — schema validation

## Severity

| Issue | Severity | Impact |
|-------|----------|--------|
| Schema mismatch | Medium | Agent wastes 2-3 attempts before discovering correct format |
| Stale-tag re-read | Low | Token cost multiplier on multi-edit sessions |
| No block-insert | Low | Agent uses fragile workarounds for structured content |
| todo_write serialization | Low | Intermittent first-call failure, succeeds on retry |
| Sibling-content loss | **High** | Silent file corruption in YAML/JSON; 3-5 edit cycles to recover per incident |
| No preview / cascading | **High** | One bad edit cascades into 10-15 recovery tool calls |

## Status

Documented for investigation. No fixes applied.
