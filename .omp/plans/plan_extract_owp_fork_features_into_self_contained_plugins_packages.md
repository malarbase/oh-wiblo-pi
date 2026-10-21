# Plan: Extract OWP Fork Features into Self-Contained Plugins/Packages

## Goal

Reduce rebase-conflict surface by moving OWP fork features that currently inject symbols into shared upstream-owned files (sdk.ts, model-registry.ts, settings-schema.ts, interactive-mode.ts, builtin-registry.ts, etc.) into self-contained extension modules or workspace packages. Execute the sync against the freshly-fetched upstream/main (3,396 commits ahead) **interleaved** with the extraction: each time a shared-file conflict appears, extract that feature into its own module instead of grafting symbols back in.

## Current State (verified 2026-06-22)

- **Merge base**: `cd9fc5557` (2026-06-02) — but `upstream/main` fetched fresh today is now at `320261fca` (v16.1.14). Fork is **3,396 commits behind**.
- **Fork commits to preserve**: 58 (listed in `git log --oneline upstream/main..main`).
- **Big upstream refactors hitting our files** (sampled from upstream log):
  - `refactor(coding-agent): removed redundant readHashLines setting` → hits `settings-schema.ts`
  - `refactor(coding-agent): consolidated TUI component shared logic` → hits status-line dir
  - `refactor(coding-agent): renamed todo_write tool to todo` → hits builtin-registry.ts
  - `refactor(coding-agent): established shared subprocess infrastructure` → hits tool impls / bash.ts
  - `refactor(coding-agent): restructured plan prompts with plan tags` → hits plan-mode/
  - `refactor(ai): consolidated authentication and deterministic ID generation` → hits ai/types.ts & providers
  - `refactor(coding-agent): consolidated message framing logic` → hits interactive-mode.ts
  - `refactor(coding-agent): consolidated editor state and unify transcript rendering` → hits interactive-mode.ts
- **Key surprise**: upstream has **already adopted** several of the symbols our registry claims we own: `session_name` segment, `usage` segment, `collab` segment, `cache_hit` segment are now in upstream `segments.ts` / `settings-schema.ts` / `presets.ts`. Our "owned symbol" registry is stale — these are no longer divergences. Our actual remaining divergence on status-line is the rename `mode → agent_mode`, which upstream never accepted (they kept `mode`).

## Critical Files Surveyed (real conflict surface)

| File | Hunks (vs upstream tip) | Real divergence |
|------|------|------|
| `sdk.ts` | 171 ins / 330 del | Mostly additive: `makeSkillDiscoverer`, `skillsOverride`, `disabledExtensions`, `let sessionManager`, string-typed systemPrompt branch. All extractable via extension `on(session_start)` + `getSystemPrompt()`. |
| `model-registry.ts` | 177 ins | `openai-compatible` discovery, LiteLLM, `#customProviderBaseUrls`, `disableStrictTools`. The type-literal additions to `ProviderDiscoverySchema` and `disableStrictTools` field on `Model<TApi>` are type-level — **cannot be moved**; become 1-line core patches. The discovery methods can move to a dedicated module invoked via a registration hook (gap: no `registerDiscoveryType` API exists upstream). |
| `settings-schema.ts` | 115 ins / 244 del | Massive staleness — our "prefer ours" dropped upstream additions like `display.shimmer`, `tui.hyperlinks`, `emojiAutocomplete`, `irc.timeoutMs`, `auth.broker.*`, `read.summarize.*`. Needs reconciliation. Our real additions: `skills.rediscoverOnNewSession`, `google`/`serpapi` in search provider enum, `askMode.*`, `edit.hashlineAutoDropPureInsertDuplicates`, `plan.storage`. |
| `presets.ts` | 7 ins / 8 del | Stale: upstream uses `mode` not our `agent_mode`. Adopt upstream. |
| `segments.ts` | 19 ins / 140 del | Mostly stale; upstream adopted `session_name`. Drop our divergent edits. |
| `interactive-mode.ts` | 356 ins / 63 del | Adds `askModeEnabled`/`debugModeEnabled` fields, `handleAskModeCommand`/`handleDebugModeCommand`, `#enterPlanMode({loadedFrom})`. Inherent to modes — extract to extension once `registerMode()`-equivalent exists; until then, this stays as core patch. |
| `builtin-registry.ts` | 70 ins / 7 del | Adds `/ask`, `/debug`, `/refresh-models`, `/plan load|run|list`. **Trivially extractable** via `registerCommand()`. |
| `extensions/loader.ts` | 69 ins / 8 del | Adds jiti + virtualModules + `@mariozechner/*` aliases. This is the extension loader itself — must stay as core patch (can't load extensions via the extension system it bootstraps). |
| `tools/bash.ts`, `tools/write.ts`, `edit/modes/patch.ts`, `edit/modes/replace.ts`, `tools/ast-edit.ts`, `tools/checkpoint.ts` | 3–5 ins each | Inline `enforceAskModeGuard(...)` calls. Extractable via `on("tool_call", ...)` hook that returns a block result — eliminates 6 shared-file hunks. |
| `web/search/provider.ts` | 13 ins | Adds `serpapi`/`google` entries to `PROVIDER_META` + `SEARCH_PROVIDER_ORDER`. Gap: no `registerSearchProvider()` API. Stays as 2-line core patch or we add the registration API upstream. |
| `web/search/types.ts` | 5 ins / 1 del | `SearchProviderId` union literal additions. Type-level — cannot move. 1-line core patch. |
| `ai/types.ts` | 0 (no diff vs tip) | Stale registry entry — confirm `disableStrictTools` already in upstream or moved elsewhere. |
| `anthropic.ts` | 15 ins / 6 del | `userBetaOverride`, `disableStrictTools` condition. Provider-internal — must stay in ai package. |

## Architecture Decision: Hybrid Delivery

- **Extensions under `.omp/extensions/owp/`** for everything the existing `ExtensionAPI` surface already supports:
  - Slash commands (`registerCommand`) — `/plan load|run|list`, `/refresh-models`, `/ask`, `/debug`
  - Skill rediscovery on `/new` (`on(session_start)` + `getSystemPrompt()` mutation + a session_manager hook)
  - Ask-mode read-only enforcement (`on("tool_call", ...)` returning a block result)
  - Lifecycle flags (`registerFlag`) for any new toggles
- **Workspace packages under `packages/owp-*/`** for substantial subsystems that need their own source tree:
  - `packages/owp-search/` — Google AI + SerpAPI providers + their config consumers (provider code already lives in `coding-agent/src/web/search/providers/{google,serpapi}.ts`; relocate to a workspace package consumed via dynamic import).
  - `packages/owp-plan-load/` — `/plan load|run|list` storage, resolve-handler, state (`packages/coding-agent/src/plan-mode/storage.ts`, `resolve-handler.ts`, `state.ts` already mostly self-contained).
  - `packages/owp-modes/` — Ask-mode + Debug-mode state machines + guards + bash-readonly + readonly-tools + prompts/system/ask-mode-context.md + debug-mode-context.md.
- **Irreducible type-level core patches** (documented in registry, kept as 1-line additions):
  - `StatusLineSegmentId` literal for `agent_mode` IF we keep that name (recommended: drop our rename and adopt upstream's `mode` segment, eliminating this entirely).
  - `SearchProviderId` literal additions for `"serpapi"` and `"google"`.
  - `disableStrictTools` field on `Model<TApi>` (in `packages/ai/src/types.ts`).
  - `skills.rediscoverOnNewSession`, `askMode.*`, `plan.storage`, `edit.hashlineAutoDropPureInsertDuplicates` setting definitions in `settings-schema.ts`.
  - `let sessionManager` (vs const) in `sdk.ts` if session_directory extension hook still needs mutation.
  - 2-line registrations in `provider.ts` (`PROVIDER_META` + `SEARCH_PROVIDER_ORDER`) until upstream adds `registerSearchProvider`.
- **Must-stay core patches** (bootstrapping infrastructure):
  - `packages/coding-agent/src/extensibility/extensions/loader.ts` — jiti + virtualModules + `@mariozechner/*` aliases. This IS the extension loader; can't extract itself.
  - `packages/coding-agent/src/config.ts` — `isBunBinary` (consumed by loader).
  - `packages/coding-agent/scripts/build-binary.ts` — `dist/owp` primary output.

## Execution Approach: Interleaved Sync + Refactor

Run `bun .omp/skills/sync-upstream/sync.ts`. For each conflict, the decision tree is:

```
1. Conflict in a file we're extracting FROM (sdk.ts, model-registry.ts,
   builtin-registry.ts, interactive-mode.ts, settings-schema.ts,
   tools/{bash,write}.ts, edit/modes/{patch,replace}.ts)?
   YES → the resolution IS the extraction:
     - Take upstream's version of the file.
     - Move our owned symbols out to .omp/extensions/owp/<name>/index.ts.
     - Verify the extension compiles and registers.
     - This drops the symbol from the shared file permanently.

2. Conflict in an extension module file we own 100% (.omp/extensions/pi-peon/,
   packages/coding-agent/src/modes/ask-mode/)?
   YES → prefer ours; adapt to any upstream signature changes.

3. Conflict in a divergence file (bun.lock, Cargo.lock, packages/*/CHANGELOG.md)?
   YES → prefer upstream.

4. Conflict in irreducible type-level patch (StatusLineSegmentId, SearchProviderId,
   disableStrictTools field)?
   YES → merge: take upstream structure, re-apply our 1-line addition.

5. DEFAULT → take upstream; verify our extracts still register.
```

## Phase Plan

### Phase 0: Pre-flight (read-only verification, no commits)

- [ ] Read `docs/maintaining-owp-fork.md § Last Sync Point` and update with `320261fca` (post-sync).
- [ ] Run `git tag sync/base/2026-06-22` BEFORE starting (per Tag Strategy).
- [ ] Run `sync.ts --dry-run` to preview conflict surface.

### Phase 1: Trivial Extractions (zero new upstream API needed)

Create `.omp/extensions/owp/index.ts` as the umbrella extension entry that imports sub-feature modules. Each sub-feature is its own file under `.omp/extensions/owp/`:

- [ ] **`owp-commands.ts`** — Move fork-only slash commands out of `builtin-registry.ts`:
  - `/ask`, `/debug`, `/refresh-models`, `/plan load|run|list` → register via `pi.registerCommand()`.
  - Leaves `builtin-registry.ts` with zero fork changes (drops 70 ins).
  - Files emptied-of-fork-content: `packages/coding-agent/src/slash-commands/builtin-registry.ts`.

- [ ] **`owp-skill-rediscovery.ts`** — Move `makeSkillDiscoverer`, `skillsOverride`, `disabledExtensions` logic out of `sdk.ts`:
  - Use `pi.on("session_start", ...)` to install the rediscover fn into the session object.
  - Use `pi.on("context", ...)` or `getSystemPrompt()` mutation to inject the override.
  - Reading `skills.rediscoverOnNewSession` setting stays in `settings-schema.ts`.
  - Goal: `sdk.ts` net diff drops to ~0 fork lines.

- [ ] **`owp-ask-mode-guard.ts`** — Move `enforceAskModeGuard(...)` calls out of `tools/{bash,write,ast-edit,checkpoint}.ts` and `edit/modes/{patch,replace}.ts`:
  - Use `pi.on("tool_call", (event, ctx) => { if (askModeActive && isMutatingTool(event)) return {blockResult} })` — verify the hook contract supports blocking tool calls (read `ToolCallEventResult` in `extensions/types.ts`).
  - Files emptied-of-fork-content: 6 tool/edit files drop their 3–5 line hunk each.

### Phase 2: Moderate Extractions (needs verification of existing API)

- [ ] **`packages/owp-modes/`** workspace package — Move:
  - `packages/coding-agent/src/modes/ask-mode/` (5 files)
  - `packages/coding-agent/src/modes/debug-mode/` (2 files)
  - `packages/coding-agent/src/prompts/system/ask-mode-context.md`, `debug-mode-context.md`
  - `packages/coding-agent/src/prompts/tools/switch-mode.md`
  - `packages/coding-agent/src/tools/switch-mode.ts`
  - Imports back into `interactive-mode.ts` shrink to a single registration call (verify if `registerCommand` + a flag is enough, or if mode state needs a new `registerMode()` API).
  - Residual core patch: `askModeEnabled`/`debugModeEnabled` boolean fields on `InteractiveMode` + `#enterPlanMode({loadedFrom})` signature if no mode-registration API.

- [ ] **`packages/owp-plan-load/`** workspace package — Move:
  - `packages/coding-agent/src/plan-mode/storage.ts`, `resolve-handler.ts`, `state.ts`, `approved-plan.ts`
  - All `/plan load|run|list` handler code from `builtin-registry.ts`.
  - Residual core patch: the `loadedFrom` param on `#enterPlanMode` and the standing resolve handler registration in `event-controller.ts`.

- [ ] **`packages/owp-search/`** workspace package — Move:
  - `packages/coding-agent/src/web/search/providers/google.ts`, `google-selectors.json`
  - `packages/coding-agent/src/web/search/providers/serpapi.ts`
  - Provider factory entries register into `provider.ts` via a small `registerSearchProvider()` gap-fill added to `ExtensionAPI` (or accept 2-line core patch in `provider.ts` if we don't want to extend the API).
  - Residual core patch: `SearchProviderId` literal additions + settings enum values in `settings-schema.ts`.

### Phase 3: Reconciliation Extractions (drop stale divergences)

During the 3,396-commit rebase, upstream will have independently landed many of our ideas. For each "owned symbol" conflict where upstream now has an equivalent:

- [ ] Drop our `agent_mode` rename — adopt upstream's `mode` segment. Removes divergence in `settings-schema.ts`, `presets.ts`, `segments.ts`, `status-line-segment-editor.ts` (4 shared files → 0 fork hunks).
- [ ] Drop our `session_name` segment — upstream has it.
- [ ] Audit `disableStrictTools` — confirm whether upstream added an equivalent; if yes, drop our type-level patch.
- [ ] Update `feature-registry.yaml` and regenerate `SKILL.md` to remove stale owned symbols.

### Phase 4: The Big Sync (3,396 commits)

With extractions done, the actual rebase surface is now:
- 0 hunks in `builtin-registry.ts` (commands extracted)
- ~0 hunks in `sdk.ts` (skill rediscovery extracted)
- 0 hunks in 6 tool/edit files (ask-mode guard extracted)
- 2-line patches in `settings-schema.ts`, `provider.ts`, `web/search/types.ts`, `ai/types.ts`
- ~5 hunks in `interactive-mode.ts` (mode state — irreducible)
- Loader/bootstrap files (`loader.ts`, `config.ts`, `build-binary.ts`) — owned entirely

Run `sync.ts` and resolve per the decision tree above. Run `--verify` after.

### Phase 5: Post-Rebase Bookkeeping

- [ ] Update `docs/maintaining-owp-fork.md § Fork Features` with the new commit list.
- [ ] Update `.omp/skills/sync-upstream/feature-registry.yaml` to reflect new extraction layout: replace the old "Ask mode" / "Debug mode" / "Plan mode /plan load" feature rows with references to the new packages and extensions.
- [ ] Regenerate `SKILL.md` via `bun .omp/skills/sync-upstream/generate-skill-md.ts`.
- [ ] Update § Owned Symbols to delete stale rows and add any residual 1-line core patches.
- [ ] `git tag sync/2026-06-22` after typecheck passes.
- [ ] Rebuild native addon (`mise exec -- bun --cwd=packages/natives run build`).
- [ ] Rebuild binary (`/install-binary`).
- [ ] Push `git push origin main --force-with-lease --follow-tags`.

## Critical Files to Modify

### New files (extractions target)
- `.omp/extensions/owp/index.ts` — umbrella extension importing sub-modules.
- `.omp/extensions/owp/owp-commands.ts` — slash commands.
- `.omp/extensions/owp/owp-skill-rediscovery.ts` — skill rediscovery.
- `.omp/extensions/owp/owp-ask-mode-guard.ts` — tool-call read-only guard.
- `packages/owp-modes/package.json` + `src/index.ts` + relocated files.
- `packages/owp-plan-load/package.json` + `src/index.ts` + relocated files.
- `packages/owp-search/package.json` + `src/index.ts` + relocated files.

### Modified files (revert fork additions after extraction)
- `packages/coding-agent/src/slash-commands/builtin-registry.ts` — remove `/ask`, `/debug`, `/refresh-models`, `/plan load|run|list` (~70 lines).
- `packages/coding-agent/src/sdk.ts` — remove `makeSkillDiscoverer`, `skillsOverride`, `disabledExtensions` (~50 lines).
- `packages/coding-agent/src/tools/bash.ts`, `write.ts`, `ast-edit.ts`, `checkpoint.ts` — remove `enforceAskModeGuard` calls (2 lines each).
- `packages/coding-agent/src/edit/modes/patch.ts`, `replace.ts` — same.
- `packages/coding-agent/src/config/settings-schema.ts` — drop our `agent_mode` rename, keep only `skills.rediscoverOnNewSession`, `askMode.*`, `plan.storage`, `edit.hashlineAutoDropPureInsertDuplicates`, `google`/`serpapi` enum entries.
- `packages/coding-agent/src/modes/components/status-line/{presets,segments,status-line-segment-editor}.ts` — revert our `agent_mode` rename; adopt upstream's `mode`.

### Registry/skill files
- `.omp/skills/sync-upstream/feature-registry.yaml` — update features list and owned_symbols.
- `.omp/skills/sync-upstream/SKILL.md` — regenerate.
- `docs/maintaining-owp-fork.md` — update § Last Sync Point and § Fork Features.

## Verification

Per extraction (before moving to the next phase):

1. `cd packages/coding-agent && bunx tsc -p tsconfig.json --noEmit` — must pass with no new errors.
2. `bun check` in any new workspace package.
3. Load test: launch `owp` and verify the extracted slash command still works (`/ask`, `/plan load`, `/refresh-models`), the ask-mode guard still blocks writes, skill rediscovery still fires on `/new`.
4. `grep -n '<symbol>' <shared file>` — confirm the symbol is GONE from the shared file after extraction.
5. `git diff --numstat cd9fc5557..HEAD -- <shared file>` — confirm the hunk count dropped.

Per sync conflict resolved:

1. Verify no `<<<<<<` markers remain.
2. Verify symbol health per `SKILL.md § After Resolution` grep list.
3. Verify no commits silently dropped: `git rev-list --count upstream/main..main` should equal expected.
4. `bun .omp/skills/sync-upstream/sync.ts --verify` final pass.

Post-sync (before push):

1. Native sentinel check: `strings packages/natives/native/pi_natives.*.node | grep "__piNativesV"` matches current `package.json#version`.
2. `mise exec -- bun --cwd=packages/natives run build` succeeds.
3. `/install-binary` produces a working binary.
4. Start `owp`, run an ask-mode session, run a `/plan load`, run `/refresh-models` — all work.
5. `git push origin main --force-with-lease --follow-tags` succeeds (use the § Push Failure loop if fork-network missing objects error appears).

## Open Questions Resolved

- **Sequence**: Sync + refactor interleaved (user decision).
- **Scope**: All feature classes in scope (user decision).
- **Delivery form**: Hybrid — extensions under `.omp/extensions/owp/` for ExtensionAPI-supported features; workspace packages for substantial subsystems; 1-line type-level patches documented in registry (user decision).
- **Status-line rename**: Drop our `agent_mode` rename and adopt upstream's `mode` segment. This eliminates 4 shared-file divergences with no feature loss (upstream's `mode` segment already renders plan/goal/loop — we just need our ask/debug to integrate into it).
