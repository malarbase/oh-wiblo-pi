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

## Tag Strategy (Remote Backup)

Use `--tag` to create lightweight annotated tags as remote backups of known-working states. These tags are pushed to origin when combined with `--push` and `--follow-tags`.

### Tag format

| Tag | Commit | Created | Purpose |
|-----|--------|---------|---------|
| `sync/base/YYYY-MM-DD` | pre-sync HEAD | Before rebase starts | Rollback point if sync fails or introduces regressions |
| `sync/YYYY-MM-DD` | post-sync HEAD | After rebase + typecheck pass | New known-working state after successful sync |
| `sync/YYYY-MM-DD-N` | — | Collision handling | If同一天 multiple syncs occur, `-N` suffix increments |

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

- `sync-state.json` lives in `~/.omp/` — lost if the machine is replaced
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

1. **Regenerate generated docs.** Run `bun .omp/skills/sync-upstream/generate-skill-md.ts` — it regenerates SKILL.md and the Fork Features table in `docs/maintaining-owp-fork.md` from `feature-registry.yaml` and git history.
2. **Update feature registry.** If new files were added, removed, or moved, update `.omp/skills/sync-upstream/feature-registry.yaml`.
3. **Review promotion candidates.** Check if any no-op stubs now have sufficient implementation need to be promoted to real code.
4. **Update divergence list.** If a previously divergent file is now owned by OWP, update both lists.

## Feature Stack

These are owp-owned files. Conflicts here prefer ours unless upstream's change is semantic.

| Feature | Owned files |
|---------|------------|
| Identity | `README.md` |
| Ask mode | `packages/coding-agent/src/modes/ask-mode/`, `packages/coding-agent/src/session/agent-session.ts`, `packages/coding-agent/src/slash-commands/builtin-registry.ts`, `packages/coding-agent/src/prompts/system/ask-mode-context.md` |
| Debug mode | `packages/coding-agent/src/modes/debug-mode/`, `packages/coding-agent/src/prompts/system/debug-mode-context.md` |
| Local discovery + two-level scan | `packages/coding-agent/src/discovery/pi.ts`, `packages/coding-agent/src/discovery/helpers.ts` |
| Skill grouping | `packages/coding-agent/src/modes/components/extensions/extension-list.ts`, `packages/coding-agent/src/modes/components/extensions/state-manager.ts`, `packages/coding-agent/src/modes/components/extensions/types.ts`, `packages/coding-agent/src/capability/skill.ts` |
| baseUrl resolution | `packages/coding-agent/src/config/model-registry.ts` |
| openai-compatible discovery | `packages/coding-agent/src/config/model-registry.ts` |
| disableStrictTools escape hatch | `packages/ai/src/types.ts`, `packages/ai/src/providers/anthropic.ts`, `packages/coding-agent/src/config/model-registry.ts` |
| Google search provider | `packages/coding-agent/src/web/search/providers/google.ts`, `packages/coding-agent/src/web/search/providers/google-ai.ts`, `packages/coding-agent/src/config/settings-schema.ts` |
| SerpAPI search provider | `packages/coding-agent/src/web/search/providers/serpapi.ts`, `packages/coding-agent/src/web/search/types.ts`, `packages/coding-agent/src/web/search/provider.ts` |
| Plan mode /plan load | `packages/coding-agent/src/plan-mode/`, `packages/coding-agent/src/slash-commands/builtin-registry.ts`, `packages/coding-agent/src/modes/ask-mode/bash-readonly.ts`, `packages/coding-agent/src/modes/ask-mode/tool-guard.ts` |
| Plan storage project path fix | `packages/coding-agent/src/modes/interactive-mode.ts` |
| Provider onboarding wizard | `packages/coding-agent/src/modes/components/provider-onboarding-wizard.ts`, `packages/coding-agent/src/modes/components/settings-defs.ts` |
| Install-binary custom command | `.omp/commands/install-binary/` |
| @mariozechner/* loader aliases | `packages/coding-agent/src/extensibility/extensions/loader.ts`, `packages/coding-agent/src/extensibility/custom-commands/loader.ts` |
| History reorganization tooling | `.omp/skills/reorganize-history/`, `.omp/commands/reorganize-fork.md` |
| Test filter scope fix | `packages/coding-agent/test/utils/filter-user-extensions.ts` |
| Unified agent mode cycle (alt+m) | `packages/coding-agent/src/modes/components/status-line/`, `packages/coding-agent/src/config/settings-schema.ts` |
| Session directory event + jiti loader + authHeader fix | `packages/coding-agent/src/sdk.ts`, `packages/coding-agent/src/session/`, `packages/coding-agent/src/capability/`, `packages/coding-agent/src/extensibility/extensions/loader.ts` |
| Cache write token tracking + bin/owp switcher | `packages/ai/src/providers/openai-completions.ts`, `bin/owp`, `docs/cache-token-tracking.md` |
| Use jiti with virtualModules in custom command loader | `packages/coding-agent/src/extensibility/custom-commands/loader.ts` |
| Fix isBunBinary in compiled binary | `packages/coding-agent/src/config.ts` |
| Build dist/owp as primary output | `packages/coding-agent/scripts/build-binary.ts` |
| Fix plan-mode approval UI + omp bin entry + ETXTBSY fix | `packages/coding-agent/src/modes/controllers/event-controller.ts`, `packages/coding-agent/package.json`, `.omp/commands/install-binary/index.ts`, `packages/coding-agent/test/tools/bash-interceptor.test.ts` |
| Google search provider + hashline recovery + mode fixes | `.omp/extensions/pi-peon/`, `.omp/skills/owp-developer/`, `packages/coding-agent/src/modes/interactive-mode.ts`, `packages/coding-agent/src/web/search/`, `packages/coding-agent/test/core/hashline.test.ts` |
| Upstream-deleted module stubs | `packages/coding-agent/src/edit/file-read-cache.ts`, `packages/coding-agent/src/edit/file-snapshot-store.ts`, `packages/coding-agent/src/edit/hashline/`, `packages/coding-agent/src/hashline-compat.ts`, `packages/coding-agent/src/tools/approval.ts`, `packages/coding-agent/src/tools/exit-plan-mode.ts`, `packages/coding-agent/src/tools/output-schema-validator.ts`, `packages/utils/src/install-id.ts`, `packages/utils/src/sanitize-text.ts` |
| sync-upstream skill and script | `.omp/skills/sync-upstream/` |
| feature-checklist extension | `.omp/extensions/feature-checklist.ts` |
| Cast node Blob to Web Blob for tsgo | `packages/utils/src/streams.ts` |
| mise.toml + native rebuild docs | `mise.toml`, `.omp/commands/sync-upstream.md` |
| Bazel build config (hermetic PATH, crate annotations) | `.bazelrc`, `MODULE.bazel`, `MODULE.bazel.lock` |
| Add .gitnexus, .claude/, CLAUDE.md to .gitignore | `.gitignore` |
| Deduplicate slash command autocomplete | `packages/coding-agent/src/modes/interactive-mode.ts` |
| Add serpapi, gemini, codex to settings-defs | `packages/coding-agent/src/modes/components/settings-defs.ts` |
| Add /refresh-models slash command | `packages/coding-agent/src/slash-commands/builtin-registry.ts` |
| Archive skill-group-toggle openspec spec | `openspec/specs/skill-group-toggle/spec.md` |
| Rediscover skills on /new after ECC toggles | `packages/coding-agent/src/sdk.ts`, `packages/coding-agent/src/capability/skill.ts` |
| Work around zlob/zig build failure on macOS 26 | `crates/pi-natives/` |
| OWP workspace and plans | `.omp/settings.json`, `.omp/plans/`, `.omp/rules/`, `.omp/extensions/` |
| OWP skills | `.omp/skills/tmux-debug/`, `.omp/skills/google-ai-research/`, `.omp/skills/system-prompts/`, `.omp/skills/semantic-compression/`, `.omp/skills/owp-developer/`, `.omp/skills/skill-installer/`, `.omp/skills/onboard-provider/` |
| OWP commands | `.omp/commands/fix-issues.md`, `.omp/commands/review-prs.md`, `.omp/commands/release.md`, `.omp/commands/triage.md`, `.omp/commands/sync-upstream.md`, `.omp/commands/install-binary.md` |
| OWP documentation | `docs/maintaining-owp-fork.md`, `docs/plan-mode-resolve-bug.md`, `docs/debug-mode-lifecycle.md`, `docs/web-native-feasibility.md`, `docs/ask_session.md`, `docs/debug_session.md`, `docs/render-mermaid.md`, `docs/non-compaction-retry-policy.md`, `docs/notebook-tool-runtime.md`, `docs/resolve-tool-runtime.md`, `docs/ERRATA-GPT5-HARMONY.md` |
| OWP spec docs | `openspec/config.yaml`, `openspec/specs/ask-mode/`, `openspec/specs/debug-mode/`, `openspec/specs/dual-mode-extension-loader/`, `openspec/specs/install-binary-command/`, `openspec/specs/mode-cycle-keybinding/`, `openspec/specs/session-directory-event/`, `openspec/specs/skill-rediscovery/`, `openspec/specs/rpc-ask-debug/`, `openspec/changes/` |
| OWP AI package | `packages/ai/` |
| OWP agent package | `packages/agent/` |
| OWP coding-agent package | `packages/coding-agent/` |
| OWP natives package | `packages/natives/` |
| OWP stats package | `packages/stats/` |
| OWP TUI package | `packages/tui/` |
| OWP utils package | `packages/utils/` |
| OWP pi-utils package | `packages/pi-utils/` |
| OWP catalog package | `packages/catalog/` |
| OWP swarm-extension package | `packages/swarm-extension/` |
| OWP Rust crates | `crates/pi-ast/`, `crates/pi-iso/`, `crates/pi-natives/`, `crates/pi-shell/` |
| OWP scripts | `scripts/` |
| OWP Python RPC | `python/omp-rpc/` |
| OWP documentation | `docs/` |
| OWP GitHub config | `.github/` |
| OWP Claude workspace | `.claude/` |
| OWP agent themes | `agent/themes/` |
| OWP plans | `plans/` |
| OWP root config and assets | `package.json`, `bunfig.toml`, `turbo.json`, `Cargo.toml`, `biome.json`, `.gitattributes`, `.prettierignore`, `.prettierrc`, `rust-toolchain.toml`, `rustfmt.toml`, `rust-analyzer.toml`, `Dockerfile`, `.dockerignore`, `Dockerfile.dockerignore`, `LICENSE`, `AGENTS.md`, `STAGES.md`, `REPORT-ISSUE-601.md`, `PLAN_FIX_689.md`, `PLAN_FIX_689_PHASE2.md`, `pi-mono.code-workspace`, `oh-my-pi-session-title-api`, `.fallowrc.jsonc`, `tsconfig.json`, `tsconfig.base.json`, `tsconfig.tools.json`, `packages/tsconfig.workspace.json`, `assets/`, `types/` |

> **Note:** The § Owned Symbols table below is generally more current than this § Feature Stack, because new shared-file symbols are registered immediately while high-level feature rows may lag. After any feature merge, audit both tables.

## Owned Symbols in Shared Files

When a conflict occurs in a file shared with upstream, the Feature Stack tells you "prefer ours"
but doesn't tell you *which lines are ours*. This section lists the exact symbols each feature
owns inside shared files.

### sdk.ts (packages/coding-agent/src/sdk.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| makeSkillDiscoverer() | Top of createAgentSession, before provider preferences | Factory returning async fn that re-discovers skills |
| skillsOverride | rebuildSystemPrompt signature (3rd param) | Optional Skill[] override for /new |
| skillsOverride ?? skills | buildSystemPromptInternal call inside rebuildSystemPrompt | Passes override if provided |
| disabledExtensions | skillsSettings object in rebuildSystemPrompt | { ...settings.getGroup('skills'), disabledExtensions: ... } |
| let sessionManager | Near top of createAgentSession | let (not const) to allow override by session_directory handlers |
| systemPrompt: options.systemPrompt | buildSystemPromptInternal call when typeof options.systemPrompt === 'string' | Only in the string-typed branch |

### settings-schema.ts (packages/coding-agent/src/config/settings-schema.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| "agent_mode" | — | Replaces upstream's 'plan_mode' in StatusLineSegmentId |
| "session_name" | — | Added to StatusLineSegmentId union |
| skills.rediscoverOnNewSession | — | Boolean setting definition |
| "google" | — | New provider id in SearchProviderId union and isSearchProviderId() |
| "google" | — | In providers.webSearch enum values and UI options |

### model-registry.ts (packages/coding-agent/src/config/model-registry.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| import { resolveConfigValue } | — | Import from ./resolve-config-value |
| #customProviderBaseUrls | — | Map<string, string> for raw baseUrl configs |
| #resolvedCommandBaseUrls | — | Map<string, string> for resolved values |
| #resolvedCommandApiKeys | — | Map<string, string> for resolved API keys |
| resolveApiKeyConfigAsync | — | Async version using resolveConfigValue |
| resolveApiKeyConfigSync | — | Sync version using Bun.spawnSync |
| #resolveCommandApiKeys | — | Async method on ModelRegistry |
| #resolveCommandBaseUrls | — | Async method on ModelRegistry |
| #rewriteProviderBaseUrl | — | Rewrites baseUrl on cached models |
| #eagerResolveCommandApiKeys | — | Sync eager resolution in constructor |
| #eagerResolveCommandBaseUrls | — | Sync eager resolution in constructor |
| "openai-compatible" | — | Added to Type.Union in ProviderDiscoverySchema |
| #discoverOpenAICompatibleModels | — | Full discovery method |
| case "openai-compatible" | — | Switch case in #discoverModelsByProviderType |
| LiteLLMModelInfo | — | Type for LiteLLM model info fields |
| #fetchLiteLLMModelInfo | — | Fetches LiteLLM's /v1/model/info |
| disableStrictTools | — | Field in ProviderConfigSchema |
| disableStrictTools? | — | Field in CustomModelOverlay |
| providerDisableStrictTools | — | Param in buildCustomModelOverlay() |
| disableStrictTools | — | In finalizeCustomModel() |
| return keyConfig | — | In fallbackResolver — returns literal API keys |

### presets.ts (packages/coding-agent/src/modes/components/status-line/presets.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| "agent_mode" | — | Replaces 'plan_mode' in leftSegments of all 7 presets |
| "session_name" | — | Added to rightSegments of all 7 presets |

### status-line-segment-editor.ts (packages/coding-agent/src/modes/components/status-line-segment-editor.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| agent_mode | — | { label: 'Mode', short: 'active mode (plan/ask/debug)' } |
| session_name | — | { label: 'Session Name', short: 'named session' } |

### segments.ts (packages/coding-agent/src/modes/components/status-line/segments.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| agentModeSegment | — | Renderer implementation |
| sessionNameSegment | — | Renderer implementation |

### types.ts (packages/ai/src/types.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| disableStrictTools? | — | Optional boolean field on Model<TApi> |

### anthropic.ts (packages/ai/src/providers/anthropic.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| userBetaOverride | — | Reads Anthropic-Beta from modelHeaders; overrides defaults |
| betaHeaderEntry | — | Header entry built from beta override |
| model.disableStrictTools === true | — | Adds to the disableStrictTools condition alongside github-copilot guard |

### types.ts (packages/agent/src/types.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| ToolApproval | — | Stub type alias after upstream deletion |
| ToolTier | — | Stub type alias after upstream deletion |
| EventLoopKeepalive | — | Stub type alias after upstream deletion |

### agent-loop.ts (packages/agent/src/agent-loop.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| instrumentedCompleteSimple | — | Stub function after upstream deletion |

### dirs.ts (packages/utils/src/dirs.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| hashPath | — | Restored after upstream deletion |

### skill.ts (packages/coding-agent/src/capability/skill.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| author, repo, tags, group | — | Skill interface metadata fields for grouping and group-toggle operations |

### helpers.ts (packages/coding-agent/src/discovery/helpers.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| scanSkillsFromDir metadata parsing | — | Parses author, repo, tags, and group from skill frontmatter into Skill objects |

### types.ts (packages/coding-agent/src/modes/components/extensions/types.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| Extension metadata fields | — | Author, repo, tags, and group properties on Extension interface |

### state-manager.ts (packages/coding-agent/src/modes/components/extensions/state-manager.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| toggleGroup | — | Bulk toggles skill extensions by tag, directory group, repo, or author |
| isSkillDisabledByGroup | — | Checks if a skill extension matches any synthetic group disabled keys |
| toggleExtensionState | — | Toggles single extension state and clears synthetic group keys when re-enabling skills |
| createExtensionSettingsAdapter | — | Adapts Settings instance to ExtensionSettingsManager interface for group toggling |

### extension-dashboard.ts (packages/coding-agent/src/modes/components/extensions/extension-dashboard.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| g keybinding & EXT_FOOTER hint | — | Keyboard shortcut g to toggle skill grouping and footer keybindings display |

### extension-list.ts (packages/coding-agent/src/modes/components/extensions/extension-list.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| Skill group badge rendering | — | Displays skill group tag in item row preview |

### inspector-panel.ts (packages/coding-agent/src/modes/components/extensions/inspector-panel.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| Grouping & Metadata panel | — | Renders Group, Author, Repo, and Tags in extension detail inspector |

### theme.ts (packages/coding-agent/src/modes/theme/theme.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| layerBadge | — | Badge renderer formatting [O], [P], and [G] layer indicators |

### settings-selector.ts (packages/coding-agent/src/modes/components/settings-selector.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| #scope | — | Target scope state ('global' | 'project') for setting mutations |
| defToItem layer mapping | — | Attaches provenance layer from settings.getLayer to SettingItem |
| s and c keybindings | — | Scope toggle and clear override key handling in handleInput |

### settings-list.ts (packages/tui/src/components/settings-list.ts)

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
| layerBadge rendering | — | Renders item row layer badges using theme hook in #renderItemRow |

## Upstream Divergences (take upstream)

These omp files exist but owp intentionally doesn't override them. Always take upstream:

- `packages/*/CHANGELOG.md` — Upstream owns release notes; owp never modifies changelog files.
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
- `python/robomp/` — Fork removes upstream robomp GitHub triage bot.
- `packages/hashline/` — Fork tracks upstream hashline verbatim (75829839db re-synced src after the recovery work was absorbed upstream); only release-version bumps differ.

> **WARNING:** The divergence list exists because these files are considered upstream-owned. If you add an owp feature that modifies one of these files, the feature will be silently lost on the next sync (the decision tree will "prefer upstream"). You must either:
> 1. Move the feature out of these files, or
> 2. Add the file to the Feature Stack registry and change the divergence list entry to note the dual ownership.

## Obsoleted Fixes

No upstream-obsoleted fixes are currently tracked.

## Intentional Removals (deleted vs upstream)

These upstream paths are intentionally absent from owp. `sync.ts --verify` fails if any other upstream file goes missing.

- `python/robomp/` — fork does not ship robomp
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

1. **Verify no conflict markers remain:**
   ```bash
   grep -rn '<<<<<<' packages/ crates/ --include='*.ts' --include='*.rs' --include='*.toml'
   ```

2. **Run parse check (not just lint):**
   ```bash
    cd packages/coding-agent && bunx tsc -p tsconfig.json --noEmit
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

4. **Verify no commits were silently dropped:**
   ```bash
   git rev-list --count upstream/main..main
   ```
   This should equal the number of fork commits rebased. If the count decreased, a commit became empty — identify which and verify the feature/bug-fix still survives.

5. **Reconcile lock files:**
   If any owp commit adds a dependency not in upstream's `bun.lock`, run:
   ```bash
   bun install
   ```
   Commit the updated `bun.lock` separately.

6. **Rebuild native addon** (always rebuild after a version bump, not just when `packages/natives/` or `crates/` changed):
   ```bash
   mise exec -- bun --cwd=packages/natives run build
   ```
   **Why always rebuild on version bump:** `Cargo.toml` / `package.json` bumps change the `__piNativesV{major}_{minor}_{patch}` sentinel that `loader-state.js` expects. A stale `.node` embeds the old sentinel and the compiled binary dies with `does not expose the ... version sentinel`. Verify: `strings packages/natives/native/pi_natives.*.node | grep "__piNativesV"` must equal the current `package.json#version` sentinel.
   Native build dependencies (e.g. `zig`) are declared in `mise.toml`. Run `mise install` first if a tool is missing.

7. **Verify models.yml schema:**
   Start owp and check for `Schema error` in output.
   If `src/config/model-registry.ts` changed `ProviderDiscoverySchema`, verify
   `~/.omp/agent/models.yml` uses valid `discovery.type` values.

8. **Rebuild and reinstall owp binary:**
   ```bash
   /install-binary
   ```

9. **Update docs/maintaining-owp-fork.md § Last Sync Point.**

10. **Push:**
    ```bash
    git push origin main --force-with-lease
    ```
    If the push fails with `remote: fatal: did not receive expected object <sha>`,
    see § Push Failure: Fork-Network Missing Objects below.

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

## Pre-Rebase Registry Validation

`sync.ts` validates every file touched by fork commits against `feature-registry.yaml` *before* starting the rebase. If any file is unregistered (not in features or divergences), the script aborts:

```
ERROR: Unregistered file in fork commit <sha>: <path>
  This file is not in feature-registry.yaml § features or § divergences.
  Add it to the registry, then regenerate SKILL.md and re-run.
```

This prevents silent loss of features on the next sync.

## Post-Rebase Automated Verification

Run `sync.ts --verify` after a completed rebase to run the full verification suite:

| Check | Method | Fail behavior |
|-------|--------|---------------|
| Conflict markers | `grep -rn '<<<<<<' packages/ crates/` | Hard fail |
| Symbol health | `grep` each owp-owned symbol from § Owned Symbols | Report PASS/MISSING |
| Commit survival | `git rev-list --count upstream/main..main` | Report expected vs actual |
| Type check | `bun check:ts` | Report pass/fail |
| Native sentinel | `strings … pi_natives.*.node \| grep "__piNativesV"` | Report version match/mismatch |

Output is a structured JSON block plus human-readable summary.

## Push Failure: Fork-Network Missing Objects

**Symptom:**
```
remote: fatal: did not receive expected object 2a0da9f7653a83fa51b38b36436aea2eb3dc7fe8
error: remote unpack failed: index-pack failed
```

**Root cause:** GitHub fork networks share an object database between the parent repo
(`can1357/oh-my-pi`) and the fork (`malarbase/oh-wiblo-pi`). During push negotiation,
the fork advertises objects it can see through the alternate as `have`, so the client
builds a thin pack with deltas against those bases. But when `receive-pack` runs
server-side it looks up the bases in the *fork's own* object DB (which doesn't see
through the alternate during writes) and finds them missing → unpack failure.

Typically triggered after the parent repo is repacked, force-pushed, or GC'd in a way
that orphans objects from the fork's view but leaves stale `have` advertisements.

**Fix:** push each missing object as a temporary ref on origin, forcing the fork to
copy it into its own object database. Loop until the main push succeeds, then delete
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
   `feature-registry.yaml` in the same commit. Then regenerate SKILL.md with `generate-skill-md.ts`
   so the Owned Symbols tables stay current. Don't wait for the next sync to discover the gap.

### Contact surface audit

Before merging a new feature commit, audit its sdk.ts diff:
- Count the number of separate insertion/modification hunks
- If > 2 hunks, consider whether the logic can be moved to a dedicated file
- If the feature adds a parameter to `rebuildSystemPrompt` or `buildSystemPromptInternal`,
  consider whether the value can be read from `session` or `settings` instead of threaded

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
