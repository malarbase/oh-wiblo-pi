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

## After Resolution

Once all conflicts are resolved:
1. If upstream changed `packages/natives/` or `crates/`, rebuild the native addon — otherwise omp will fail to start with a missing symbol error:
   ```bash
   mise exec -- bun --cwd=packages/natives run build:native
   ```
   Native build dependencies (e.g. `zig`) are declared in `mise.toml`. Run `mise install` first if a tool is missing.
2. `bun check:ts` must pass — do not push if it fails.
3. Start omp and confirm no `Schema error` in the startup output. If `~/.omp/agent/models.yml` fails schema validation (e.g. an invalid `discovery.type`), fix it before continuing — schema changes in `src/config/model-registry.ts` are not flagged by `bun check:ts`.
4. Update `docs/maintaining-owp-fork.md` § Last Sync Point with the new upstream base commit and date.
5. `git push origin main --force-with-lease`

## Rollback

If anything goes wrong:
```bash
git rebase --abort          # during rebase
git reset --hard ORIG_HEAD  # after a bad rebase completed
git push origin main --force-with-lease
```
