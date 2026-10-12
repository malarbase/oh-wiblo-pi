---
name: sync-upstream
description: Rebase oh-wiblo-pi (owp) fork/main against oh-my-pi (omp) upstream/main. Handles conflict resolution automatically for trivial cases and escalates semantic conflicts. Read this skill before running sync.ts.
---
<!-- forklift v1 -->

# Sync Upstream (owp ← omp)

Rebase `fork/main` against `upstream/main` (omp). Run `sync.ts` to execute. This skill provides the knowledge you need to resolve conflicts correctly during the rebase.

## Script

```bash
bun .omp/skills/sync-upstream/sync.ts
```

Git operations run through the command above. You resolve conflicts using the decision tree below, then signal the script to continue or abort.

## Conflict Resolution Decision Tree

When the script reports a conflict, apply this logic in order:

```
1. Is the file in the owp feature registry (§ Feature Stack)?
   YES → prefer ours; adapt to upstream's shape if needed; verify compilation
   IMPACT: Keeps the feature alive. RISK: Misses upstream bug-fixes or refactors.
   MITIGATION: After resolve, diff against upstream to see excluded changes.

2. Is upstream's change a rename/refactor of a symbol we call?
   YES → update our callsite to the new name/signature; verify compilation
   IMPACT: Feature survives with updated imports. No functional loss.

3. Is upstream's change altering the *semantics* of an interface we depend on?
   (changed return contract, removed a mode, restructured data flow)
   YES → ESCALATE: "upstream changed X which feature Y depends on — adapt or drop?"
   IMPACT: No automatic choice is safe. Preferring upstream breaks our feature;
           preferring ours risks building on a deprecated contract.

4. Is the file in the omp intentional-divergence list (§ Upstream Divergences)?
   YES → prefer upstream (we intentionally don't own it)
   IMPACT: Intentional loss of any owp modifications. If unexpected, the file
           may have been incorrectly classified — add it to the registry.

5. MERGE PATH (manual, for shared files with upstream shape changes):
   - Take upstream structure.
   - Graft our owned symbols from § Owned Symbols into the new shape.
   - Verify compilation. Use when upstream's change is structural, not semantic.

  6. DEFAULT → prefer upstream; verify our feature still compiles
     IMPACT: Benefit from upstream's work. RISK: Our feature may need import fixes.

  7. Did upstream delete an entire package that our features depend on?
     YES → port the package source into an appropriate local module tree,
           create a barrel index.ts, update all imports (source + test).
     IMPACT: Preserves feature. RISK: Future upstream changes to the original
             package must be manually backported.
     MITIGATION: Add the ported module directory to the Feature Stack.
  ```

> **Empty commits during rebase:** If a commit from owp becomes empty during rebase, git drops it silently. This happens when upstream independently applied the same bug fix. The sync script warns about dropped commits after a successful rebase; if you see one, verify its change is present in upstream's code before proceeding.

**Shape conflict** (auto-resolve): renamed field, reorganized function, moved import path.
**Semantic conflict** (escalate): different behavior for same operation, incompatible assumptions, feature overlap.

## Upstream-Deleted Module Protocol

When upstream deletes an entire package or module that OWP features depend on, the decision tree step 7 handles porting. This section refines that with lessons from the `packages/hashline/` migration.

### Categorize the deleted module

| Category | Definition | Action |
|----------|-----------|--------|
| **Dead stub** | No live consumers, no-op implementation, only barrel re-export | Delete file, remove barrel re-export, verify compilation |
| **No-op stub with consumers** | Live callers exist but implementation is empty/returns default | Keep stub, add to "Upstream-deleted module stubs" feature registry entry, consider promotion |
| **Real implementation** | Full forked code with active consumers | Port to workspace package or local module tree, add to feature registry |
| **Re-export stub** | Only re-exports upstream symbols, no added value | Search for symbol usage *through the re-export* before deleting; prefer direct import |

### Porting workflow (real implementation)

1. **Check for upstream replacement.** Is there a published package (e.g., `@oh-my-pi/hashline`)? If yes, prefer migrating imports to it rather than maintaining a vendored copy.
2. **Resolve cross-package imports.** If the module imports from coding-agent paths (e.g., `../edit/file-read-cache`), extract minimal interfaces or create local adapters so the package has no reverse dependency into coding-agent.
3. **Restore workspace membership.** Upstream deletion may remove the package from root `package.json` workspaces. Add it back. Create `package.json` if missing.
4. **Fix named imports / aliases.** Upstream packages may use different export names (e.g., `MismatchError` vs `HashlineMismatchError`). Create a small compat module (`hashline-compat.ts`) for production-used aliases. Update test-only aliases to upstream names.
5. **Migrate all imports.** Bulk-replace vendored path → package import across source and test files. Watch for barrel re-exports.
6. **Copy bundled assets.** If the module imports `.lark` grammar or `.md` prompts via `with { type: "text" }`, verify the upstream package bundles them. If not, copy to a stable location owned by the consuming feature.
7. **Verify compilation and tests.** Run `bun run check:types` in affected packages and relevant unit tests.
8. **Register in feature registry.** Add the ported module path to the Feature Stack and update the divergence entry if one existed.

### Common mistakes

- **Forgetting barrel re-exports.** Removing a stub file but leaving `export * from "./deleted"` in `index.ts` causes `TS2307` errors.
- **Perl array interpolation.** Bulk `perl -pi -e 's/.../.../g'` on `@oh-my-pi/hashline` eats the `@` because perl interpolates it as an array. Escape: `perl -pi -e 's|\.\./hashline|@oh-my-pi/hashline|g'`.
- **Missing workspace entry.** `packages/hashline/` exists but `package.json` workspaces doesn't list it → Bun install ignores it.
- **Duplicate exports.** After migration, both the new package and an old compat re-export may export the same symbol, causing TS conflicts. Remove redundant re-exports.

## Test Compilation Patterns

When upstream deletes symbols that tests reference, use these canonical patterns
(in order of preference):

1. **Deleted import → local stub.** Add a `const` or `function` stub at the top
   of the test file rather than modifying the source module.
2. **Deleted property → cast to `any`.** `(obj as any).prop` or
   `(obj as any)["prop"]` for settings/schema properties upstream removed.
3. **Method signature mismatch on stubs.** If upstream replaced a real function
   with a no-op stub, widen the stub signature to `..._args: unknown[]` to keep
   tests compiling.
4. **Duplicate variable declaration.** Rename the second declaration
   (e.g. `result` → `result2`) rather than reordering blocks.
5. **Relative path mismatch.** Test files at `packages/*/test/**/` use
   `../src/` for sibling imports, not `../../src/`.

## History Rewrites (reorganize-history) — Safety Rules

The 2026-09-21 rebuild is the cautionary case: it was a *tree* graft, not a patch
replay, and it silently disconnected at least ten capabilities. The source files
survived; the wiring did not. `.pi` discovery kept its module but lost its single
`import "./pi"`, ask mode kept its guard helpers but lost every call site,
`session_directory` vanished from the tree entirely, and `switch_mode` stayed
registered while nothing could dispatch it. Nineteen follow-up "repair" commits
were needed to claw back part of it.

Rules for any history rewrite (`reorganize-history`, topical rebase, squash-and-regroup):

1. **Replay patches, never graft trees.** `git rebase -i` squash, or
   `reset --soft` + staged re-commits. Building a new tree from a snapshot and
   recommitting it drops wiring the snapshot's owner never recorded.
2. **Snapshot first, and write the pre-rewrite head into `sync-state.json`
   *before* starting.** Afterwards the reflog is your only undo.
3. **Group by file overlap, not by topic.** The rebase cost is one resolution per
   (fork commit × conflicted file); grouping so each shared file is touched by
   exactly one commit is what reduces work. Topic grouping alone changes nothing
   about the number of hunks.
4. **Run `--verify` after, and require import liveness to be clean.** A rewrite
   that leaves an owned source with zero importers has not preserved that feature,
   no matter how the diff looks.
5. **Rebaseline `expected_fork_commit_count` only after verify passes**, then
   regenerate SKILL.md.

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

5. **Register symbols immediately.** When your feature touches a shared file, update
   `feature-registry.yaml` in the same commit. Then regenerate SKILL.md with `forklift-render`
   so the Owned Symbols tables stay current. Don't wait for the next sync to discover the gap.

### Contact surface audit

Before merging a new feature commit, audit its sdk.ts diff:
- Count the number of separate insertion/modification hunks
- If > 2 hunks, consider whether the logic can be moved to a dedicated file
- If the feature adds a parameter to `rebuildSystemPrompt` or `buildSystemPromptInternal`,
  consider whether the value can be read from `session` or `settings` instead of threaded

## Post-Rebase Bookkeeping

- **Review promotion candidates.** Check if any no-op stubs now have sufficient implementation need to be promoted to real code.
- **Fork Features table.** `generate-skill-md.ts` refreshes the Fork Features table in `docs/maintaining-owp-fork.md` from git history. It also rewrites SKILL.md from the legacy template — re-run `forklift-render` afterwards so the skill stays forklift-managed.

## Tag Strategy (Remote Backup)

Use `--tag` to create lightweight annotated tags as remote backups of known-working states. These tags are pushed to origin when combined with `--push` and `--follow-tags`.

### Tag format

| Tag | Commit | Created | Purpose |
|-----|--------|---------|---------|
| `sync/base/YYYY-MM-DD` | pre-sync HEAD | Before rebase starts | Rollback point if sync fails or introduces regressions |
| `sync/YYYY-MM-DD` | post-sync HEAD | After rebase + typecheck pass | New known-working state after successful sync |
| `sync/YYYY-MM-DD-N` | — | Collision handling | If multiple syncs land on the same day, `-N` suffix increments |

### Usage

```bash
# Full sync with tags and push
bun .omp/skills/sync-upstream/sync.ts --push --tag

# Tags created locally; push separately
bun .omp/skills/sync-upstream/sync.ts --tag
# ... later ...
git push origin main --force-with-lease --follow-tags
```

### Why tags instead of just sync-state.json?

- `sync-state.json` lives at `~/.omp/sync-state.json` — lost if the machine is replaced
- Tags on origin survive independently of local state
- Tags survive `git gc` and reflog expiry better than loose refs
- Easy historical diff: `git log --oneline sync/2026-06-01..main`

### Rollback with tags

If a pushed sync introduces regressions:

```bash
# Find the last good pre-sync tag
git tag -l 'sync/base/*' | sort | tail -1
# Reset to it
git reset --hard sync/base/2026-06-01
# Force push the rollback
git push origin main --force-with-lease
```

## Post-Rebase Checklist

After all conflicts are resolved and compilation passes, perform these bookkeeping steps before force-pushing:

- **Regenerate generated docs.** Run `forklift-render --registry .forklift/registry.yaml` — it regenerates SKILL.md and, when `harness.registry_path` is set, the legacy runner's registry copy from the registry.
- **Update feature registry.** If new files were added, removed, or moved, update `.forklift/registry.yaml` and re-render (above).
- **Update divergence list.** If a previously divergent file is now owned by owp, update both lists.

## Feature Stack

These are owp-owned files. Conflicts here prefer ours unless upstream's change is semantic.

| Feature | Owned files |
|---------|------------|
| Settings layering (project/global scope + revert) | `packages/coding-agent/src/config/settings.ts`, `packages/coding-agent/src/config/settings-ui.ts`, `packages/tui/src/overlays/settings-defs.ts`, `packages/tui/src/overlays/settings-selector.ts` |
| Identity | `README.md` |
| Ask mode | `packages/coding-agent/src/modes/ask-mode/`, `packages/coding-agent/src/session/agent-session.ts`, `packages/coding-agent/src/slash-commands/builtin-registry.ts`, `packages/coding-agent/src/prompts/system/ask-mode-context.md` |
| switch_mode tool | `packages/coding-agent/src/tools/switch-mode.ts`, `packages/coding-agent/src/tools/index.ts`, `packages/coding-agent/src/prompts/tools/switch-mode.md` |
| Debug mode | `packages/coding-agent/src/modes/debug-mode/`, `packages/coding-agent/src/prompts/system/debug-mode-context.md`, `packages/coding-agent/src/session/agent-session.ts`, `packages/coding-agent/src/slash-commands/builtin-registry.ts` |
| Local discovery + two-level scan | `packages/coding-agent/src/discovery/pi.ts`, `packages/coding-agent/src/discovery/helpers.ts`, `packages/coding-agent/src/discovery/index.ts` |
| Skill grouping | `packages/tui/src/overlays/extensions/extension-list.ts`, `packages/tui/src/overlays/extensions/extension-dashboard.ts`, `packages/coding-agent/src/modes/components/extensions/state-manager.ts`, `packages/coding-agent/src/capability/skill.ts` |
| baseUrl resolution | `packages/coding-agent/src/config/model-registry.ts` |
| openai-compatible discovery | `packages/coding-agent/src/config/model-registry.ts` |
| disableStrictTools escape hatch | `packages/ai/src/types.ts`, `packages/ai/src/providers/anthropic.ts`, `packages/coding-agent/src/config/model-registry.ts` |
| Google search provider | `packages/coding-agent/src/web/search/providers/google.ts`, `packages/coding-agent/src/web/search/providers/google-ai.ts`, `packages/coding-agent/src/config/settings-schema.ts` |
| SerpAPI search provider | `packages/coding-agent/src/web/search/providers/serpapi.ts`, `packages/coding-agent/src/web/search/types.ts`, `packages/coding-agent/src/web/search/provider.ts`, `packages/ai/src/stream.ts` |
| Plan mode /plan load | `packages/coding-agent/src/plan-mode/`, `packages/coding-agent/src/slash-commands/builtin-registry.ts`, `packages/coding-agent/src/modes/ask-mode/bash-readonly.ts`, `packages/coding-agent/src/modes/ask-mode/tool-guard.ts` |
| Plan storage project path fix | `packages/coding-agent/src/modes/interactive-mode.ts`, `packages/coding-agent/src/plan-mode/storage.ts`, `packages/coding-agent/src/plan-mode/approved-plan.ts`, `packages/coding-agent/src/plan-mode/resolve-handler.ts`, `packages/coding-agent/src/modes/controllers/event-controller.ts` |
| Provider onboarding wizard | `packages/coding-agent/src/modes/components/provider-onboarding-wizard.ts`, `packages/tui/src/overlays/settings-defs.ts` |
| Install-binary custom command | `packages/coding-agent/src/extensibility/custom-commands/bundled/install-binary/` |
| @mariozechner/* loader aliases | `packages/coding-agent/src/extensibility/plugins/legacy-pi-compat.ts`, `packages/coding-agent/src/extensibility/extensions/loader.ts`, `packages/coding-agent/src/extensibility/custom-commands/loader.ts` |
| History reorganization tooling | `.omp/skills/reorganize-history/`, `.omp/commands/reorganize-fork.md` |
| Test filter scope fix | `packages/coding-agent/test/utils/filter-user-extensions.ts` |
| Unified agent mode cycle (alt+k) | `packages/tui/src/status-line/`, `packages/tui/src/app-keybindings.ts`, `packages/coding-agent/src/modes/controllers/input-controller.ts`, `packages/coding-agent/src/config/settings-schema.ts` |
| Session directory event + jiti loader + authHeader fix | `packages/coding-agent/src/sdk.ts`, `packages/coding-agent/src/session/`, `packages/coding-agent/src/capability/`, `packages/coding-agent/src/extensibility/extensions/loader.ts` |
| Cache write token tracking + bin/owp switcher | `packages/ai/src/providers/openai-completions.ts`, `bin/owp`, `docs/cache-token-tracking.md` |
| Use jiti with virtualModules in custom command loader | `packages/coding-agent/src/extensibility/custom-commands/loader.ts` |
| Fix isBunBinary in compiled binary | `packages/utils/src/env.ts` |
| Build dist/owp as primary output | `packages/coding-agent/scripts/build-binary.ts` |
| Compiled-binary boot fixes (bytecode ESM + addon archive extraction) | `packages/coding-agent/scripts/compile-binary.ts`, `packages/natives/native/loader-state.js`, `scripts/ci-release-build-binaries.test.ts` |
| Fix plan-mode approval UI + omp bin entry + ETXTBSY fix | `packages/coding-agent/src/modes/controllers/event-controller.ts`, `packages/coding-agent/package.json`, `packages/coding-agent/src/extensibility/custom-commands/bundled/install-binary/index.ts`, `packages/coding-agent/test/tools/bash-interceptor.test.ts` |
| Google search provider + hashline recovery + mode fixes | `.omp/extensions/pi-peon/`, `.omp/skills/owp-developer/`, `packages/coding-agent/src/modes/interactive-mode.ts`, `packages/coding-agent/src/web/search/` |
| Upstream-deleted module stubs | `packages/coding-agent/src/tools/approval.ts`, `packages/coding-agent/src/tools/output-schema-validator.ts`, `packages/utils/src/sanitize-text.ts` |
| sync-upstream skill and script | `.omp/skills/sync-upstream/` |
| feature-checklist extension | `.omp/extensions/feature-checklist.ts` |
| Cast node Blob to Web Blob for tsgo | `packages/utils/src/stream.ts` |
| mise.toml + native rebuild docs | `mise.toml`, `.omp/commands/sync-upstream.md` |
| Bazel build config (hermetic PATH, crate annotations) | `.bazelrc`, `MODULE.bazel`, `MODULE.bazel.lock` |
| Add .gitnexus, .claude/, CLAUDE.md to .gitignore | `.gitignore` |
| Deduplicate slash command autocomplete | `packages/coding-agent/src/modes/interactive-mode.ts` |
| Add serpapi, gemini, codex to settings-defs | `packages/tui/src/overlays/settings-defs.ts` |
| Add /refresh-models slash command | `packages/coding-agent/src/slash-commands/builtin-registry.ts` |
| MiMo-Code edit mode | `packages/coding-agent/src/edit/modes/mimo.ts`, `packages/coding-agent/src/edit/index.ts`, `packages/coding-agent/src/utils/edit-mode.ts`, `packages/tui/src/tools/edit.ts` |
| Archive skill-group-toggle openspec spec | `openspec/specs/skill-group-toggle/spec.md` |
| Rediscover skills on /new after ECC toggles | `packages/coding-agent/src/sdk.ts`, `packages/coding-agent/src/session/agent-session.ts`, `packages/coding-agent/src/config/settings-schema.ts`, `packages/coding-agent/src/capability/skill.ts` |
| Work around zlob/zig build failure on macOS 26 | `crates/pi-natives/` |
| OWP workspace and plans | `.omp/settings.json`, `.omp/plans/`, `.omp/rules/`, `.omp/extensions/` |
| OWP Claude workspace | `.claude/` |
| OWP skills | `.omp/skills/tmux-debug/`, `.omp/skills/google-ai-research/`, `.omp/skills/system-prompts/`, `.omp/skills/semantic-compression/`, `.omp/skills/owp-developer/`, `.omp/skills/skill-installer/`, `.omp/skills/onboard-provider/` |
| OWP commands | `.omp/commands/fix-issues.md`, `.omp/commands/review-prs.md`, `.omp/commands/release.md`, `.omp/commands/triage.md`, `.omp/commands/sync-upstream.md` |
| OWP spec docs | `openspec/config.yaml`, `openspec/specs/ask-mode/`, `openspec/specs/debug-mode/`, `openspec/specs/dual-mode-extension-loader/`, `openspec/specs/install-binary-command/`, `openspec/specs/mode-cycle-keybinding/`, `openspec/specs/session-directory-event/`, `openspec/specs/skill-rediscovery/`, `openspec/specs/rpc-ask-debug/` |
| OWP AI package | `packages/ai/` |
| OWP agent package | `packages/agent/` |
| OWP coding-agent package | `packages/coding-agent/` |
| OWP natives package | `packages/natives/` |
| OWP stats package | `packages/stats/` |
| OWP TUI package | `packages/tui/` |
| OWP utils package | `packages/utils/` |
| OWP catalog package | `packages/catalog/` |
| OWP Rust crates | `crates/pi-ast/`, `crates/pi-iso/`, `crates/pi-natives/`, `crates/pi-shell/` |
| OWP scripts | `scripts/` |
| OWP Python RPC | `python/omp-rpc/` |
| OWP documentation | `docs/` |
| OWP GitHub config | `.github/` |
| OWP root config and assets | `package.json`, `bunfig.toml`, `Cargo.toml`, `.gitattributes`, `rust-toolchain.toml`, `rustfmt.toml`, `rust-analyzer.toml`, `Dockerfile`, `.dockerignore`, `LICENSE`, `AGENTS.md`, `.fallowrc.jsonc`, `tsconfig.json`, `tsconfig.base.json`, `tsconfig.tools.json`, `packages/tsconfig.workspace.json`, `assets/`, `types/` |
| Command dispatch composition | `packages/coding-agent/src/slash-commands/builtin-registry.ts`, `packages/coding-agent/src/slash-commands/builtin-modes.ts`, `packages/coding-agent/src/modes/controllers/event-controller.ts`, `packages/tui/src/overlays/extensions/extension-list.ts` |
| Forklift harness | `.forklift/` |

> **Note:** The § Owned Symbols table below is generally more current than this § Feature Stack, because new shared-file symbols are registered immediately while high-level feature rows may lag. After any feature merge, audit both tables.

## Owned Symbols in Shared Files

When a conflict occurs in a file shared with upstream, the Feature Stack tells you "prefer ours"
but doesn't tell you *which lines are ours*. This section lists the exact symbols each feature
owns inside shared files.

### agent-session.ts (packages/coding-agent/src/session/agent-session.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| storage | — | Fork graft (auto-derived from live diff) |
| finalPlanFilePath | — | Fork graft (auto-derived from live diff) |
| sessionLike | — | Fork graft (auto-derived from live diff) |

### builtin-registry.ts (packages/coding-agent/src/slash-commands/builtin-registry.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| agent | — | Fork command def (/agent) in inline registry block |
| drop | — | Fork command def (/drop) in inline registry block |
| ask | — | Fork command def (/ask) in inline registry block |

### build-binary.ts (packages/coding-agent/scripts/build-binary.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| owpPath | — | Fork graft (auto-derived from live diff) |
| fs | — | Fork graft (auto-derived from live diff) |
| ompPath | — | Fork graft (auto-derived from live diff) |

### event-controller.ts (packages/coding-agent/src/modes/controllers/event-controller.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| approval | — | Fork graft (auto-derived from live diff) |
| details | — | Fork graft (auto-derived from live diff) |
| planDetails | — | Fork graft (auto-derived from live diff) |

### index.ts (packages/coding-agent/src/web/search/index.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| captchaBehavior | — | Fork graft (auto-derived from live diff) |
| configuredBehavior | — | Fork graft (auto-derived from live diff) |
| captchaTimeout | — | Fork graft (auto-derived from live diff) |
| configuredTimeout | — | Fork graft (auto-derived from live diff) |

### google.ts (packages/coding-agent/src/web/search/providers/google.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| signal | — | Fork graft (auto-derived from live diff) |

### helpers.ts (packages/coding-agent/src/discovery/helpers.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| rawMeta | — | Fork graft (auto-derived from live diff) |
| author | — | Fork graft (auto-derived from live diff) |
| repo | — | Fork graft (auto-derived from live diff) |
| tags | — | Fork graft (auto-derived from live diff) |
| group | — | Fork graft (auto-derived from live diff) |

### settings-list.ts (packages/tui/src/components/settings-list.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| defaultLayerBadge | — | Fork graft (auto-derived from live diff) |
| item | — | Fork graft (auto-derived from live diff) |
| labelPadded | — | Fork graft (auto-derived from live diff) |
| hasAnyLayer | — | Fork graft (auto-derived from live diff) |
| badgeWidth | — | Fork graft (auto-derived from live diff) |
| badge | — | Fork graft (auto-derived from live diff) |
| layer | — | Fork graft (auto-derived from live diff) |
| valueMaxWidth | — | Fork graft (auto-derived from live diff) |

### extension-list.ts (packages/tui/src/overlays/extensions/extension-list.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| order | — | Fork graft (auto-derived from live diff) |
| nextIdx | — | Fork graft (auto-derived from live diff) |
| item | — | Fork graft (auto-derived from live diff) |
| searchText | — | Fork graft (auto-derived from live diff) |
| startIdx | — | Fork graft (auto-derived from live diff) |
| endIdx | — | Fork graft (auto-derived from live diff) |
| rowWidth | — | Fork graft (auto-derived from live diff) |
| listItem | — | Fork graft (auto-derived from live diff) |

### settings-selector.ts (packages/tui/src/overlays/settings-selector.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| selected | — | Fork graft (auto-derived from live diff) |
| def | — | Fork graft (auto-derived from live diff) |

### segments.ts (packages/tui/src/status-line/segments.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| ask | — | Fork graft (auto-derived from live diff) |
| content | — | Fork graft (auto-derived from live diff) |
| debug | — | Fork graft (auto-derived from live diff) |
| pauseSuffix | — | Fork graft (auto-derived from live diff) |

### utils.ts (packages/tui/src/utils.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| fileHyperlink | — | Fork graft (auto-derived from live diff) |
| tryResolveInternalUrlSync | — | Fork graft (auto-derived from live diff) |

### settings-ui.ts (packages/coding-agent/src/config/settings-ui.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| layer | — | Fork graft (auto-derived from live diff) |

### settings.ts (packages/coding-agent/src/config/settings.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| deleteByPath | — | Fork graft (auto-derived from live diff) |
| current | — | Fork graft (auto-derived from live diff) |
| i | — | Fork graft (auto-derived from live diff) |
| next | — | Fork graft (auto-derived from live diff) |
| segments | — | Fork graft (auto-derived from live diff) |
| scope | — | Fork graft (auto-derived from live diff) |
| prev | — | Fork graft (auto-derived from live diff) |
| hook | — | Fork graft (auto-derived from live diff) |

### omp-plugins.ts (packages/coding-agent/src/discovery/omp-plugins.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| roots | — | Fork graft (auto-derived from live diff) |

### blackbox.ts (packages/coding-agent/src/edit/blackbox.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| createEditBlackboxRecorder | — | Fork graft (black-box edit recorder shared by churn tests) |

### index.ts (packages/coding-agent/src/edit/index.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| openArgStream | — | Fork graft (description streaming reused by upstream EditTool) |

### normalize.ts (packages/coding-agent/src/edit/normalize.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| countLeadingWhitespace | — | Fork graft (auto-derived from live diff) |
| count | — | Fork graft (auto-derived from live diff) |
| i | — | Fork graft (auto-derived from live diff) |
| char | — | Fork graft (auto-derived from live diff) |
| getLeadingWhitespace | — | Fork graft (auto-derived from live diff) |
| isNonEmptyLine | — | Fork graft (auto-derived from live diff) |
| minIndent | — | Fork graft (auto-derived from live diff) |
| lines | — | Fork graft (auto-derived from live diff) |

### input-controller.ts (packages/coding-agent/src/modes/controllers/input-controller.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| cycleModeKeys | — | Fork graft (auto-derived from live diff) |

### auto-generated-guard.ts (packages/coding-agent/src/tools/auto-generated-guard.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| CHECK_BYTE_COUNT | — | Fork graft (auto-derived from live diff) |
| HEADER_LINE_LIMIT | — | Fork graft (auto-derived from live diff) |
| KNOWN_GENERATOR_PATTERN | — | Fork graft (auto-derived from live diff) |
| AUTO_GENERATED_HEADER_MARKERS | — | Fork graft (auto-derived from live diff) |
| COMMENT_STYLES_BY_EXTENSION | — | Fork graft (auto-derived from live diff) |
| COMMENT_STYLES_BY_BASENAME | — | Fork graft (auto-derived from live diff) |
| AUTO_GENERATED_FILENAME_PATTERNS | — | Fork graft (auto-derived from live diff) |
| stripBom | — | Fork graft (auto-derived from live diff) |

### builtin-names.ts (packages/coding-agent/src/tools/builtin-names.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| HIDDEN_TOOL_NAMES | — | Fork graft (auto-derived from live diff) |

### checkpoint.ts (packages/coding-agent/src/tools/checkpoint.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| askBlock | — | Fork graft (auto-derived from live diff) |

### resolve.ts (packages/coding-agent/src/tools/resolve.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| runResolveInvocation | — | Fork graft (auto-derived from live diff) |

### embed-native.ts (packages/natives/scripts/embed-native.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| embeddedAddonTypedefs | — | Fork graft (auto-derived from live diff) |
| reset | — | Fork graft (auto-derived from live diff) |
| outputPath | — | Fork graft (auto-derived from live diff) |
| packageJsonPath | — | Fork graft (auto-derived from live diff) |
| nativeDir | — | Fork graft (auto-derived from live diff) |
| fileExists | — | Fork graft (auto-derived from live diff) |
| validateAddonSentinel | — | Fork graft (auto-derived from live diff) |
| isCurrentPlatform | — | Fork graft (auto-derived from live diff) |

### eval-bench-runs.ts (scripts/eval-bench-runs.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| cleaned | — | Fork graft (auto-derived from live diff) |
| segs | — | Fork graft (auto-derived from live diff) |

### db.ts (packages/stats/src/db.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| getModelTimeSeries | — | Fork graft (auto-derived from live diff) |
| rows | — | Fork graft (auto-derived from live diff) |
| getModelPerformanceSeries | — | Fork graft (auto-derived from live diff) |

### approved-plan.ts (packages/coding-agent/src/plan-mode/approved-plan.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| resolvePlanLikePath | — | Fork graft (auto-derived from live diff) |
| normalized | — | Fork graft (auto-derived from live diff) |
| renameApprovedPlanFile | — | Fork graft (auto-derived from live diff) |
| resolveOptions | — | Fork graft (auto-derived from live diff) |
| resolvedSource | — | Fork graft (auto-derived from live diff) |
| resolvedDestination | — | Fork graft (auto-derived from live diff) |
| destinationStat | — | Fork graft (auto-derived from live diff) |

### interactive-mode.ts (packages/coding-agent/src/modes/interactive-mode.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| loadedFrom | — | Fork graft (auto-derived from live diff) |
| targetPlanPath | — | Fork graft (auto-derived from live diff) |
| ctx | — | Fork graft (auto-derived from live diff) |
| plans | — | Fork graft (auto-derived from live diff) |
| items | — | Fork graft (auto-derived from live diff) |
| choice | — | Fork graft (auto-derived from live diff) |
| resolved | — | Fork graft (auto-derived from live diff) |
| preserveContext | — | Fork graft (auto-derived from live diff) |

### types.ts (packages/coding-agent/src/web/search/types.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| SEARCH_PROVIDER_OPTIONS | — | Fork graft (auto-derived from live diff) |
| SEARCH_PROVIDER_LABELS | — | Fork graft (auto-derived from live diff) |

### auth-broker-config.ts (packages/coding-agent/src/session/auth-broker-config.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| getAuthBrokerTokenFilePath | — | Fork graft (auto-derived from live diff) |
| discoverAuthStorage | — | Fork graft (auto-derived from live diff) |
| dbPath | — | Fork graft (auto-derived from live diff) |
| storage | — | Fork graft (auto-derived from live diff) |

### state-manager.ts (packages/coding-agent/src/modes/components/extensions/state-manager.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| createExtensionSettingsAdapter | — | Fork graft (auto-derived from live diff) |
| skillMeta | — | Fork graft (auto-derived from live diff) |
| author | — | Fork graft (auto-derived from live diff) |
| repo | — | Fork graft (auto-derived from live diff) |
| tags | — | Fork graft (auto-derived from live diff) |
| group | — | Fork graft (auto-derived from live diff) |
| isDisabled | — | Fork graft (auto-derived from live diff) |
| isShadowed | — | Fork graft (auto-derived from live diff) |

## Upstream Divergences (take upstream)

These omp files exist but owp intentionally doesn't override them. Always take upstream:

- `packages/*/CHANGELOG.md` — Upstream owns release notes; owp never modifies changelog files.
- `crates/pi-edit/grammars/mimo.ts` — Fork-only pre-repair duplicate of the live mimo mode (packages/coding-agent/src/edit/modes/mimo.ts); its imports never resolved from the crate dir and nothing referenced it. Deleted 2026-10-01 — native pi-edit owns grammars/*.lark.
- `bun.lock` — Lockfile is authoritative upstream; run bun install if deps differ.
- `Cargo.lock` — Rust lockfile tracks upstream's Cargo.toml changes.
- `MODULE.bazel.lock` — Generated Bazel lockfile; regenerate after merges.
- `packages/natives/native/index.js` — Built native artifact; regenerated via mise exec -- bun --cwd=packages/natives run build.
- `crates/brush-core-vendored/` — Vendored upstream Rust crate.
- `crates/brush-builtins-vendored/` — Vendored upstream Rust crate.
- `packages/react-edit-benchmark/` — Upstream benchmark tooling.
- `packages/typescript-edit-benchmark/` — Upstream benchmark tooling.
- `packages/omp-extension-swarm/` — Upstream extension package.
- `packages/omp-stats/` — Upstream stats dashboard package.
- `packages/git-tool/` — Upstream git tooling package.
- `.turbo/` — Generated Turbo cache artifacts; should not be tracked.
- `Dockerfile.robomp` — Fork removes upstream robomp Docker builder.
- `Dockerfile.robomp.dockerignore` — Fork removes upstream robomp Docker builder context.
- `packages/hashline/` — Upstream nativized hashline into crates/pi-edit (18.2.x) and dropped the JS package; the fork adopted the native engine and retired its JS pipeline (2026-09-21).

> **WARNING:** The divergence list exists because these files are considered upstream-owned. If you add an owp feature that modifies one of these files, the feature will be silently lost on the next sync (the decision tree will "prefer upstream"). You must either:
> 1. Move the feature out of these files, or
> 2. Add the file to the Feature Stack registry and change the divergence list entry to note the dual ownership.

## Obsoleted Fixes

These commits were previously part of the fork but became empty during rebase because upstream independently applied the same fix (or made it unnecessary). They are tracked here so sync.ts can suppress false-positive dropped-commit warnings.

### Compiled-binary boot fixes (bytecode ESM + addon archive extraction)

| Pre-rebase hash | Description | Upstream obsoleted in |
|-----------------|-------------|-----------------------|
| `64c020a8185329f64ea9610ab9a37c89c6187662` | retain ESM semantics in compiled bytecode | `020ed9fdc1f3e997f5175c3748a82482893e8d59` |
| `64c020a8185329f64ea9610ab9a37c89c6187662` | extract embedded native addon from tar.gz archive | `cc258b1757` |

## Intentional Removals (deleted vs upstream)

These upstream paths are intentionally absent from owp. `sync.ts --verify` fails if any other upstream file goes missing.

- `python/robomp/` — The fork carries only a trimmed subset of upstream robomp (59 tracked files); the remaining upstream paths are absent on purpose and would otherwise be restored by the next sync. The subset that IS kept is fork-modified and is registered under features (OWP Python RPC), not here.
- `packages/hashline/` — JS hashline retired — upstream native engine (crates/pi-edit) adopted
- `packages/coding-agent/src/hashline/` — legacy ¶-era hashline module — superseded by native engine
- `packages/coding-agent/src/edit/hashline/` — JS hashline executor retired — native engine adopted
- `packages/coding-agent/src/edit/modes/patch.ts` — JS patch executor retired — native crates/pi-edit/src/modes/patch.rs adopted (Phase B, 1ef85e092c)
- `packages/coding-agent/src/edit/modes/apply-patch.ts` — JS apply-patch executor retired — native crates/pi-edit/src/modes/apply_patch.rs adopted (Phase B, 1ef85e092c)
- `packages/tui/src/overlays/extensions/extension-list.ts.bak` — stale fork backup copy of extension-list.ts; the live overlay is upstream-owned under packages/tui/
- `packages/coding-agent/src/edit/sloppy.ts` — JS sloppy executor retired — native modes/sloppy adopted
- `packages/coding-agent/src/edit/streaming.ts` — JS streaming preview retired — native EditSession.openArgStream adopted
- `packages/coding-agent/src/edit/renderer.ts` — fork renderer retired — EditToolDetails from pi-tui/tools/edit
- `packages/coding-agent/src/edit/result.ts` — fork result plumbing retired with JS executors
- `packages/coding-agent/src/edit/snapshot-details.ts` — fork snapshot-details retired with JS executors
- `packages/coding-agent/src/edit/file-read-cache.ts` — superseded by native EditStore snapshots for anchor recovery
- `packages/coding-agent/src/edit/edit-clipboard.ts` — superseded by native EditStore clipboard registers
- `packages/coding-agent/src/edit/file-snapshot-store.ts` — superseded by native EditStore snapshot store
- `packages/coding-agent/test/auth-broker-migrate.test.ts` — fork stubs resolveAuthBrokerConfig to null (no auth-broker) — broker-migration tests cannot pass by design
- `packages/coding-agent/test/auth-broker-snapshot-cache.test.ts` — fork stubs resolveAuthBrokerConfig to null — broker snapshot-cache tests cannot pass by design
- `packages/coding-agent/test/auth-gateway-account-pool.test.ts` — fork does not ship the auth gateway broker
- `packages/coding-agent/test/issue-8096-broker-unreachable-startup.test.ts` — broker-unreachable startup paths are unreachable with the fork's null broker config; describeAuthBrokerStartupError is retained defensively
- `packages/coding-agent/test/core/block-replace.test.ts` — JS hashline block-op tests retired — native block ops covered by crates/pi-edit tests + read-edit suite
- `packages/coding-agent/test/edit-streaming-preview.test.ts` — JS streaming preview tests retired — native openArgStream covered by streaming-edit-abort.test.ts
- `packages/coding-agent/test/` — chore(owp): remove upstream-only components
- `packages/utils/test/` — chore(owp): remove upstream-only components
- `Dockerfile.robomp*` — chore(owp): remove upstream-only components
- `Dockerfile.dockerignore` — chore(owp): remove upstream-only components
- `packages/agent/test/compaction-error-status.test.ts` — chore(owp): remove upstream-only components
- `packages/agent/test/compaction-telemetry.test.ts` — chore(owp): remove upstream-only components
- `packages/agent/test/compaction-thinking-level.test.ts` — chore(owp): remove upstream-only components
- `packages/agent/test/yield.test.ts` — chore(owp): remove upstream-only components
- `packages/hashline/README.md` — chore(owp): remove upstream-only components
- `packages/hashline/tsconfig.publish.json` — chore(owp): remove upstream-only components
- `packages/hashline/bench/recovery-session-chain.ts` — chore(owp): remove upstream-only components
- `packages/hashline/test/format-v2.test.ts` — chore(owp): remove upstream-only components
- `packages/hashline/test/recovery-session-chain.test.ts` — chore(owp): remove upstream-only components
- `packages/hashline/test/snapshots.test.ts` — chore(owp): remove upstream-only components
- `packages/coding-agent/examples/sdk/12-redis-sessions.ts` — chore(owp): remove upstream-only components
- `packages/coding-agent/examples/sdk/13-sql-sessions.ts` — chore(owp): remove upstream-only components
- `packages/catalog/test/google-vertex-discovery.test.ts` — chore(owp): remove upstream-only components
- `packages/catalog/test/wafer.test.ts` — chore(owp): remove upstream-only components
- `packages/tui/test/emoji-autocomplete.test.ts` — chore(owp): remove upstream-only components
- `packages/tui/test/hyperlink.test.ts` — chore(owp): remove upstream-only components
- `packages/tui/test/raw-sse-pretty.test.ts` — chore(owp): remove upstream-only components
- `packages/tui/test/settings-list-theme.test.ts` — chore(owp): remove upstream-only components
- `packages/tui/test/shimmer.test.ts` — chore(owp): remove upstream-only components
- `packages/tui/test/status-line-cache-hit.test.ts` — chore(owp): remove upstream-only components
- `packages/tui/test/task-nested-live-render.test.ts` — chore(owp): remove upstream-only components

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

## Sync Options

`sync.ts` supports additional flags beyond the basic rebase:

| Flag | Behavior |
|------|----------|
| `--push` | Push origin/main after successful rebase |
| `--dry-run` | Preview-only: shows what would happen without modifying `main` |
| `--continue` | Resume a previously started rebase (run checks, push) |
| `--verify` | Run post-rebase verification suite (conflict markers, symbols, typecheck) |
| `--tag` | Create lightweight tags for pre-sync and post-sync commits as remote backups (pushed with `--follow-tags` when `--push` is also set) |

## After Resolution

Once all conflicts are resolved:

- **Verify no conflict markers remain:**
  ```bash
  git grep -n '<<<<<<<'
  ```

- **Run the type check (not just lint):**
  ```bash
  bun check
  ```
  This catches structural breakage (truncated objects, orphaned references) that lint misses. Ignore pre-existing errors in dependency directories or upstream-owned files.

- **Run the full verification suite — this is the check that matters:**
  ```bash
  bun .omp/skills/sync-upstream/sync.ts --verify
  ```
  It gates on exit code and covers, in order: conflict markers, symbol health,
  commit survival, protecting tests (feature behavioral contracts), **feature
  coverage** (every behavioral feature names a `protecting_tests` entry),
  **import liveness** (every owned source has at least one importer), footprint,
  type check, and the deletion audit.

  Import liveness is the check that catches a feature whose files are present and
  registered but whose wiring was dropped: nothing imports it, so its own file
  still greps fine while the capability is dead.

- **Verify owp-owned symbols survive:** prefer `sync.ts --verify`'s
  symbol-health step over ad-hoc greps; the § Owned Symbols table is partly
  auto-derived and its entries are local variable names, so a hand grep against it
  proves nothing about a feature's reachability.

- **Verify no commits were silently dropped:**
  ```bash
  git rev-list --count upstream/main..main
  ```
  Compare against `expected_fork_commit_count` in the registry. Treat a moved
  number as a *symptom only*: it names no feature. When it moves, use the
  per-feature coverage and liveness results to find which capability actually
  stopped running.

- **Reconcile lock files:** if any owp commit adds a dependency not in upstream's `bun.lock`, run `bun install` and commit the updated `bun.lock` separately.
- **Rebuild native addon** (always rebuild after a version bump, not just when `packages/natives/` or `crates/` changed):
  ```bash
  mise exec -- bun --cwd=packages/natives run build
  ```
  **Why always rebuild on version bump:** `Cargo.toml` / `package.json` bumps change the `__piNativesV{major}_{minor}_{patch}` sentinel that `loader-state.js` expects. A stale `.node` embeds the old sentinel and the compiled binary dies with `does not expose the ... version sentinel`. Verify: `strings packages/natives/native/pi_natives.*.node | grep "__piNativesV"` must equal the current `package.json#version` sentinel.
  Native build dependencies (e.g. `zig`) are declared in `mise.toml`. Run `mise install` first if a tool is missing.
- **Verify models.yml schema:** start owp and check for `Schema error` in output. If `src/config/model-registry.ts` changed `ProviderDiscoverySchema`, verify `~/.omp/agent/models.yml` uses valid `discovery.type` values.
- **Rebuild and reinstall owp binary:** `/install-binary`

- **Update docs/maintaining-owp-fork.md § Last Sync Point.**

- **Push:**
  ```bash
  git push origin main --force-with-lease
  ```
  If the push fails with `remote: fatal: did not receive expected object <sha>`,
  see § Push Failure: Fork-Network Missing Objects below.

## Pre-Rebase Registry Validation

`sync.ts` validates every file touched by fork commits against the registry *before* starting the rebase. If any file is unregistered (not in features or divergences), the script aborts:

```
ERROR: Unregistered file in fork commit <sha>: <path>
  This file is not in the registry's § features or § divergences.
  Add it to the registry, then regenerate SKILL.md and re-run.
```

This prevents silent loss of features on the next sync.

## Post-Rebase Automated Verification

Run `sync.ts --verify` after a completed rebase to run the full verification suite:

| Check | Method | Fail behavior |
|-------|--------|---------------|
| Conflict markers | `git grep -n '<<<<<<<' -- 'packages/**/*.ts' 'packages/**/*.tsx'` | Hard fail |
| Symbol health | `grep` each owp-owned symbol from § Owned Symbols | Report PASS/MISSING |
| Commit survival | `git rev-list --count upstream/main..main` | Report expected vs actual |
| Protecting tests | `bun test <protecting_tests>` per registered file | Hard fail |
| Feature coverage | every behavioral feature declares `protecting_tests` | Hard fail |
| Import liveness | owned sources resolved against parsed import specifiers | Hard fail |
| Type check | `bun check` | Report pass/fail |
| Native sentinel | `strings … pi_natives.*.node \| grep "__piNativesV"` | Report version match/mismatch |

Output is a structured JSON block plus human-readable summary.

## Push Failure: Fork-Network Missing Objects

**Symptom:**
```
remote: fatal: did not receive expected object 2a0da9f7653a83fa51b38b36436aea2eb3dc7fe8
error: remote unpack failed: index-pack failed
```

**Root cause:** GitHub fork networks share an object database between the parent repo
and the fork. During push negotiation,
the fork advertises objects it can see through the alternate as `have`, so the client
builds a thin pack with deltas against those bases. But when `receive-pack` runs
server-side it looks up the bases in the *fork's own* object DB (which doesn't see
through the alternate during writes) and finds them missing → unpack failure.

Typically triggered after the parent repo is repacked, force-pushed, or GC'd in a way
that orphans objects from the fork's view but leaves stale `have` advertisements.

**Fix:** push each missing object as a temporary ref on origin, forcing the fork to
copy it into its own object database. Loop until the target push succeeds, then delete
the temp refs.

```bash
for i in $(seq 1 15); do
  out=$(git push origin main --force-with-lease 2>&1)
  missing=$(echo "$out" | grep -oE 'expected object [0-9a-f]{40}' | awk '{print $3}' | head -1)
  [ -z "$missing" ] && { echo "$out" | tail -3; break; }
  echo "Pinning missing object: $missing"
  git fetch upstream "$missing" 2>&1 | tail -1
  git push origin "$missing:refs/heads/_owns_${missing:0:8}" 2>&1 | tail -1
done

# Cleanup
refs=$(git ls-remote origin '_owns_*' | awk '{print $2}' | sed 's|refs/heads/||')
[ -n "$refs" ] && git push origin --delete $refs
```

Each iteration unblocks one delta base. Three to five iterations is typical for a
multi-week sync gap; sometimes only one. The temporary `_owns_<sha8>` branches are
harmless if forgotten but should be deleted when the push completes.

## Rollback

If the rebase introduces regressions, `sync.ts` records the pre-sync HEAD in `~/.omp/sync-state.json` before touching git.

**Automatic revert (recommended):**
```bash
bun .omp/skills/sync-upstream/sync.ts --revert
```
This resets `fork/main` to the exact pre-sync commit without touching the reflog.
It only works if the last sync was not yet marked `completed`; completed syncs must be reverted manually to avoid accidentally discarding upstream changes.

**Check sync history:**
```bash
bun .omp/skills/sync-upstream/sync.ts --status
```
Shows the last sync attempt, pre-sync HEAD, upstream base, and last 5 log entries from `~/.omp/sync-log.jsonl`.

**Manual fallback:**
```bash
git rebase --abort          # during rebase
git reset --hard ORIG_HEAD  # after a bad rebase completed (if you didn't push)
git push origin main --force-with-lease
```

The append-only log at `~/.omp/sync-log.jsonl` records every attempt, so you can correlate regression patterns with specific upstream bases.
