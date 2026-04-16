---
name: sync-upstream
description: Rebase oh-wiblo-pi (owp) fork/main against oh-my-pi (omp) upstream/main. Handles conflict resolution automatically for trivial cases and escalates semantic conflicts. Read this skill before running sync.ts.
---

# Sync Upstream (owp ← omp)

Rebase `fork/main` against `upstream/main` (omp). Run `sync.ts` to execute. This skill provides the knowledge you need to resolve conflicts correctly during the rebase.

## Script

```bash
bun .omp/skills/sync-upstream/sync.ts
```

The script handles git operations and outputs structured conflict reports. You resolve conflicts using the decision tree below, then signal the script to continue or abort.

## Conflict Resolution Decision Tree

When the script reports a conflict, apply this logic in order:

```
1. Is the file in the owp feature registry (§ Feature Stack)?
   YES → prefer ours; adapt to upstream's shape if needed; verify compilation

2. Is upstream's change a rename/refactor of a symbol we call?
   YES → update our callsite to the new name/signature; verify compilation

3. Is upstream's change altering the *semantics* of an interface we depend on?
   (changed return contract, removed a mode, restructured data flow)
   YES → ESCALATE: "upstream changed X which feature Y depends on — adapt or drop?"

4. Is the file in the omp intentional-divergence list (§ Upstream Divergences)?
   YES → prefer upstream (we intentionally don't own it)

5. DEFAULT → prefer upstream; verify our feature still compiles
```

**Shape conflict** (auto-resolve): renamed field, reorganized function, moved import path.
**Semantic conflict** (escalate): different behavior for same operation, incompatible assumptions, feature overlap.

## Feature Stack

These are owp-owned files. Conflicts here prefer ours unless upstream's change is semantic.

| Feature | Owned files |
|---------|------------|
| Identity | `README.md` |
| Ask mode | `src/modes/ask-mode/`, `src/session/agent-session.ts` (ask sections), `src/slash-commands/builtin-registry.ts` (ask/debug entries), `src/prompts/system/ask-mode-context.md` |
| Debug mode | `src/modes/debug-mode/`, `src/prompts/system/debug-mode-context.md` |
| Local discovery | `src/discovery/pi.ts`, `src/discovery/helpers.ts` (two-level scan section) |
| Skill grouping | `src/modes/components/extensions/extension-list.ts`, `src/modes/components/extensions/state-manager.ts`, `src/modes/components/extensions/types.ts`, `src/capability/skill.ts` (group fields) |
| baseUrl resolution | `src/config/model-registry.ts` (#customProviderBaseUrls, #resolvedCommandBaseUrls, #rewriteProviderBaseUrl, resolveApiKeyConfigSync, resolveApiKeyConfigAsync) |
| openai-compatible discovery | `src/config/model-registry.ts` (ProviderDiscoverySchema `"openai-compatible"` literal, #discoverOpenAICompatibleModels, case in #discoverModelsByProviderType) |


## Owned Symbols in Shared Files

When a conflict occurs in a file shared with upstream, the Feature Stack tells you "prefer ours"
but doesn't tell you *which lines are ours*. This section lists the exact symbols each feature
owns inside shared files.

### sdk.ts (packages/coding-agent/src/sdk.ts)

sdk.ts is upstream-owned infrastructure. OWP adds specific symbols listed below.
During conflicts: **take HEAD for the surrounding structure**, then verify these symbols survive.

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| Skill rediscovery | `makeSkillDiscoverer()` | Top of `createAgentSession`, before provider preferences | Factory returning async fn that re-discovers skills |
| Skill rediscovery | `skillsOverride` param | `rebuildSystemPrompt` signature (3rd param) | Optional `Skill[]` override for `/new` |
| Skill rediscovery | `skillsOverride ?? skills` | `buildSystemPromptInternal` call inside `rebuildSystemPrompt` | Passes override if provided |
| Disabled extensions | `disabledExtensions` spread | `skillsSettings` object in `rebuildSystemPrompt` | `{ ...settings.getGroup("skills"), disabledExtensions: ... }` |
| Session directory | `let sessionManager` | Near top of `createAgentSession` | `let` (not `const`) to allow override by session_directory handlers |
| Custom prompt | `customPrompt: options.systemPrompt` | `buildSystemPromptInternal` call when `typeof options.systemPrompt === "string"` | Only in the string-typed branch, not the default prompt build |

**Critical pattern:** In sdk.ts conflicts, the OWP `>>>>>>>` block typically contains an older
version of surrounding code that HEAD already supersedes. Always take HEAD for the structure;
only graft in the specific owp-owned symbols listed above.

### settings-schema.ts (packages/coding-agent/src/config/settings-schema.ts)

| Feature | Symbol | Description |
|---------|--------|-------------|
| Unified mode | `"agent_mode"` in `StatusLineSegmentId` | Replaces upstream's `"plan_mode"` |
| Session naming | `"session_name"` in `StatusLineSegmentId` | Added to the union |
| Skill rediscovery | `skills.rediscoverOnNewSession` setting | Boolean setting definition |

### model-registry.ts (packages/coding-agent/src/config/model-registry.ts)

| Feature | Symbol | Description |
|---------|--------|-------------|
| baseUrl resolution | `import { resolveConfigValue }` | Import from `./resolve-config-value` |
| baseUrl resolution | `#customProviderBaseUrls` field | Map<string, string> for raw baseUrl configs |
| baseUrl resolution | `#resolvedCommandBaseUrls` field | Map<string, string> for resolved values |
| baseUrl resolution | `#resolvedCommandApiKeys` field | Map<string, string> for resolved API keys |
| baseUrl resolution | `resolveApiKeyConfigAsync()` | Async version using resolveConfigValue |
| baseUrl resolution | `resolveApiKeyConfigSync()` | Sync version using Bun.spawnSync |
| baseUrl resolution | `#resolveCommandApiKeys()` | Async method on ModelRegistry |
| baseUrl resolution | `#resolveCommandBaseUrls()` | Async method on ModelRegistry |
| baseUrl resolution | `#rewriteProviderBaseUrl()` | Rewrites baseUrl on cached models |
| baseUrl resolution | `#eagerResolveCommandApiKeys()` | Sync eager resolution in constructor |
| baseUrl resolution | `#eagerResolveCommandBaseUrls()` | Sync eager resolution in constructor |
| baseUrl resolution | baseUrl resolution block in `#loadCustomModels()` | `rawBaseUrl` / `resolvedBaseUrl` locals |
| openai-compatible | `"openai-compatible"` literal in `ProviderDiscoverySchema` | Added to Type.Union |
| openai-compatible | `#discoverOpenAICompatibleModels()` | Full discovery method |
| openai-compatible | `case "openai-compatible"` in `#discoverModelsByProviderType` | Switch case |
| openai-compatible | `LiteLLMModelInfo` interface | Type for LiteLLM model info fields |
| openai-compatible | `#fetchLiteLLMModelInfo()` | Fetches LiteLLM's /v1/model/info |

### presets.ts (packages/coding-agent/src/modes/components/status-line/presets.ts)

| Feature | Symbol | Description |
|---------|--------|-------------|
| Unified mode | `"agent_mode"` in leftSegments | Replaces `"plan_mode"` in all 7 presets |
| Session naming | `"session_name"` in rightSegments | Added to all 7 presets |

### status-line-segment-editor.ts

| Feature | Symbol | Description |
|---------|--------|-------------|
| Unified mode | `agent_mode` entry in `SEGMENT_INFO` | `{ label: "Mode", short: "active mode (plan/ask/debug)" }` |
| Session naming | `session_name` entry in `SEGMENT_INFO` | `{ label: "Session Name", short: "named session" }` |

### segments.ts (packages/coding-agent/src/modes/components/status-line/segments.ts)

| Feature | Symbol | Description |
|---------|--------|-------------|
| Unified mode | `agentModeSegment` | Renderer implementation |
| Session naming | `sessionNameSegment` | Renderer implementation |

## Upstream Divergences (take upstream)

These omp files exist but owp intentionally doesn't override them. Always take upstream:

- `src/modes/components/status-line-segment-editor.ts` — upstream naming, owp has `HookInputComponent` / `HookSelectorComponent`
- `src/modes/components/hook-input.ts`, `src/modes/components/hook-selector.ts` — owp uses these names (upstream uses `extension-input`, `extension-selector`)
- `packages/*/CHANGELOG.md` — always take upstream
- `bun.lock`, `Cargo.lock` — always take upstream

## Escalation Format

When escalating, output exactly:

```
ESCALATE
file: <path>
reason: <one sentence: what upstream changed and which owp feature it affects>
upstream: <brief description of upstream's version>
ours: <brief description of owp's version>
question: adapt our feature to upstream's change, or drop the upstream change?
```

## sdk.ts Conflict Triage

sdk.ts conflicts on nearly every sync because upstream and owp both modify `createAgentSession()`.
The OWP commits were written against older baselines, so git produces conflicts where the
`>>>>>>>` block contains a stale version of the function — not just the owp delta.

**Resolution pattern:**
1. Take HEAD for the surrounding structure (the function body, toolSession object, etc.)
2. Verify each owp-owned symbol from the § Owned Symbols table is present
3. If a symbol is missing, add it back surgically — do NOT splice in the OWP `>>>>>>>` block
4. After resolution, run `bunx tsgo -p tsconfig.json --noEmit` to catch parse errors early
   (biome lint is insufficient — it reports style issues but misses structural breakage)

**Common failure mode:** A conflict in the `toolSession: ToolSession = { ... }` object.
HEAD's version may start mid-object after a conflict marker. If you take HEAD without
checking, you can truncate the object body. Always verify the object has all its properties
by comparing with `git show upstream/main:packages/coding-agent/src/sdk.ts`.

## After Resolution

Once all conflicts are resolved:

1. **Verify no conflict markers remain:**
   ```bash
   grep -rn '<<<<<<' packages/ crates/ --include='*.ts' --include='*.rs' --include='*.toml'
   ```

2. **Run parse check (not just lint):**
   ```bash
   cd packages/coding-agent && bunx tsgo -p tsconfig.json --noEmit
   ```
   This catches structural breakage (truncated objects, orphaned references) that biome misses.
   Ignore pre-existing errors in `node_modules/` or upstream-owned files.

3. **Verify owp-owned symbols survive:**
   ```bash
   # sdk.ts symbols
   grep -n 'makeSkillDiscoverer\|skillsOverride\|disabledExtensions.*settings.get\|let sessionManager' packages/coding-agent/src/sdk.ts
   # model-registry.ts symbols
   grep -n 'resolveConfigValue\|#customProviderBaseUrls\|openai-compatible\|#discoverOpenAICompatibleModels' packages/coding-agent/src/config/model-registry.ts
   # settings-schema.ts symbols
   grep -n 'agent_mode\|session_name' packages/coding-agent/src/config/settings-schema.ts
   ```

4. **Reconcile lock files:**
   If any owp commit adds a dependency not in upstream's `bun.lock`, run:
   ```bash
   bun install
   ```
   Commit the updated `bun.lock` separately.

5. **Rebuild native addon** (if upstream changed `packages/natives/` or `crates/`):
   ```bash
   mise exec -- bun --cwd=packages/natives run build
   ```
   Native build dependencies (e.g. `zig`) are declared in `mise.toml`. Run `mise install` first if a tool is missing.

6. **Verify models.yml schema:**
   Start owp and check for `Schema error` in output.
   If `src/config/model-registry.ts` changed `ProviderDiscoverySchema`, verify
   `~/.omp/agent/models.yml` uses valid `discovery.type` values.

7. **Rebuild and reinstall owp binary:**
   ```bash
   /install-binary
   ```

8. **Update docs/maintaining-owp-fork.md § Last Sync Point.**

9. **Push:**
   ```bash
   git push origin main --force-with-lease
   ```

## Guidelines for New Features

The biggest determinant of rebase difficulty is how many lines a feature injects into shared
upstream files — especially `sdk.ts`. Features that own their own files rebase cleanly.
Features that scatter inline additions through `createAgentSession()` conflict on every sync.

### Design principles

1. **Own your files.** Put feature logic in new files under `src/modes/`, `src/config/`, or
   `src/capability/`. Import and call from the minimum number of shared callsites. Files you
   own entirely survive rebases with zero conflicts.

2. **Minimize sdk.ts contact surface.** If you must touch `createAgentSession()`:
   - Prefer adding one field to an options object or constructor over inline logic
   - Prefer a single import + single call over scattered inline additions
   - Prefer reading state lazily from `session` or `settings` at call time over threading
     values through intermediate functions
   - Each separate insertion point in sdk.ts = one potential conflict hunk per sync

3. **Extend, don't fork, shared types.** If upstream has `StatusLineSegmentId`, add your
   literal to the union — don't create a parallel type. If upstream has `ProviderDiscoverySchema`,
   add your literal to the existing Type.Union — don't create a separate schema. This gives you
   one small conflict hunk ("add entry to list") instead of a structural divergence.

4. **Use the extension/hook system when it exists.** Upstream's extensibility system
   (`extensionRunner`, hooks, event handlers) is designed for exactly this. When possible,
   implement features as extensions rather than core modifications.

5. **Register symbols immediately.** When your feature touches a shared file, update the
   Owned Symbols table in this skill file in the same commit. Also add the file path to
   `SHARED_FILES` in `.omp/extensions/feature-checklist.ts` so the hook detects future
   changes to it. Don't wait for the next sync to discover the gap.

### Contact surface audit

Before merging a new feature commit, audit its sdk.ts diff:
- Count the number of separate insertion/modification hunks
- If > 2 hunks, consider whether the logic can be moved to a dedicated file
- If the feature adds a parameter to `rebuildSystemPrompt` or `buildSystemPromptInternal`,
  consider whether the value can be read from `session` or `settings` instead of threaded

## Rollback

If anything goes wrong:
```bash
git rebase --abort          # during rebase
git reset --hard ORIG_HEAD  # after a bad rebase completed
git push origin main --force-with-lease
```
