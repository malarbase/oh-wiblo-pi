# Maintaining oh-wiblo-pi (owp): Living Rebase Fork of oh-my-pi (omp)

This document describes the fork maintenance strategy for **oh-wiblo-pi** as a permanent rebase fork of **oh-my-pi**. It complements `docs/porting-from-pi-mono.md` (which governs omp's relationship with pi-mono) by defining owp's relationship with omp.

## Philosophy

**owp = omp + feature stack.** The fork's `main` branch is a linear sequence of feature commits stacked on top of `upstream/main` (omp's main). Every omp update is pulled via rebase, with LLM agents handling trivial conflicts and escalating semantic changes.

The goal: use all your features, always on the latest omp, with minimal maintenance friction.

---

## Branch Structure

```
upstream/main (omp)      ─────────────────► (17 commits/day, ~528/month)
                                           ▲
fork/main (owp)          upstream/main
                         + [identity]
                         + [ask/debug]
                         + [skill grouping]
                         + [future...]       ◄── PR targets here
                                            ▲
feature branch           upstream/main
                         + [new feature]     ◄── rebase against upstream, PR to fork/main
```

**Key rule:** `fork/main` is always `upstream/main` + a linear stack of squashed feature commits. No merge commits. Each feature is one clean commit.

---

## Last Sync Point

**Upstream base:** `eab72e88e4` (latest upstream/main)
**Date:** 2026-08-26
**omp commits since:** ~2345 (17.2.12 → 18.0.4)
To generate patches for your next sync:
```bash
git format-patch 896bf5f33e..upstream/main
```

Update this section after each successful rebase.

---

## Fork Features (Curated Stack)

> fork/main is a linear stack of fork commits on top of `upstream/main`. The table below is **generated** from git history by `.omp/skills/sync-upstream/generate-skill-md.ts` — do not edit it by hand; run the script instead.

<!-- GENERATED:fork-commits:start -->
Total: 61 fork commits on top of `upstream/main`.

| Commit | Feature | Owned Files | Status |
|--------|---------|------------|--------|
| `707796dea3` | feat(owp): Identity | `README.md` | docs only |
| `9e168685e3` | feat(owp): Ask mode | `packages/coding-agent/src/modes/ask-mode/ask-mode-guard.ts`, `packages/coding-agent/src/modes/ask-mode/bash-readonly.ts`, `packages/coding-agent/src/modes/ask-mode/readonly-tools.ts`, `packages/coding-agent/src/modes/ask-mode/state.ts`, `packages/coding-agent/src/modes/ask-mode/tool-guard.ts`, … (3 more) | code |
| `b426cc1200` | feat(owp): Debug mode | `packages/coding-agent/src/modes/debug-mode/log-server.ts`, `packages/coding-agent/src/modes/debug-mode/state.ts`, `packages/coding-agent/src/prompts/system/debug-mode-context.md` | code |
| `7c4e6d9504` | feat(owp): Local discovery + two-level scan | `packages/coding-agent/src/discovery/helpers.ts`, `packages/coding-agent/src/discovery/pi.ts` | code |
| `b402fb7401` | feat(owp): Skill grouping | `packages/coding-agent/src/capability/skill.ts`, `packages/coding-agent/src/modes/components/extensions/extension-list.ts`, `packages/coding-agent/src/modes/components/extensions/state-manager.ts`, `packages/coding-agent/src/modes/components/extensions/types.ts` | code |
| `b3aa072913` | feat(owp): baseUrl resolution | `packages/coding-agent/src/config/model-registry.ts` | code |
| `d6bf14ac28` | feat(owp): Google search provider | `packages/coding-agent/src/config/settings-schema.ts`, `packages/coding-agent/src/web/search/providers/google-ai.ts`, `packages/coding-agent/src/web/search/providers/google.ts` | code |
| `458dca678e` | feat(owp): SerpAPI search provider | `packages/coding-agent/src/web/search/provider.ts`, `packages/coding-agent/src/web/search/providers/serpapi.ts`, `packages/coding-agent/src/web/search/types.ts` | code |
| `112967dbe2` | feat(owp): Plan mode /plan load | `packages/coding-agent/src/plan-mode/approved-plan.ts`, `packages/coding-agent/src/plan-mode/resolve-handler.ts`, `packages/coding-agent/src/plan-mode/state.ts`, `packages/coding-agent/src/plan-mode/storage.ts` | code |
| `85b11b0423` | feat(owp): Plan storage project path fix | `packages/coding-agent/src/modes/interactive-mode.ts` | code |
| `71be1f3804` | feat(owp): Provider onboarding wizard | `packages/coding-agent/src/modes/components/provider-onboarding-wizard.ts` | code |
| `e102eaa520` | feat(owp): @mariozechner/* loader aliases | `packages/coding-agent/src/extensibility/custom-commands/loader.ts`, `packages/coding-agent/src/extensibility/extensions/loader.ts` | code |
| `fae088b234` | feat(owp): History reorganization tooling | `.omp/commands/reorganize-fork.md`, `.omp/skills/reorganize-history/SKILL.md`, `.omp/skills/reorganize-history/organize.ts` | code |
| `1bd9a1725f` | feat(owp): Test filter scope fix | `packages/coding-agent/test/utils/filter-user-extensions.ts` | code |
| `9d3da559af` | feat(owp): Unified agent mode cycle (alt+m) | `packages/coding-agent/src/modes/components/status-line/component.ts`, `packages/coding-agent/src/modes/components/status-line/segments.ts`, `packages/coding-agent/src/modes/components/status-line/types.ts` | code |
| `5d1ca1a6ae` | feat(owp): Session directory event + jiti loader + authHeader fix | `packages/coding-agent/src/sdk.ts`, `packages/coding-agent/src/session/auth-broker-config.ts`, `packages/coding-agent/src/session/redis-session-storage.ts`, `packages/coding-agent/src/session/sql-session-storage.ts` | code |
| `4686359554` | feat(owp): Cache write token tracking + bin/owp switcher | `bin/owp`, `docs/cache-token-tracking.md` | code |
| `61f3c26b79` | feat(owp): Build dist/owp as primary output | `packages/coding-agent/scripts/build-binary.ts` | code |
| `6b3160013c` | feat(owp): Fix plan-mode approval UI + omp bin entry + ETXTBSY fix | `packages/coding-agent/package.json`, `packages/coding-agent/src/modes/controllers/event-controller.ts`, `packages/coding-agent/test/tools/bash-interceptor.test.ts` | code |
| `4ea0bbff1d` | feat(owp): Google search provider + hashline recovery + mode fixes | `.omp/extensions/pi-peon/config.ts`, `.omp/extensions/pi-peon/index.ts`, `.omp/extensions/pi-peon/install.ts`, `.omp/extensions/pi-peon/pack.ts`, `.omp/extensions/pi-peon/package.json`, … (22 more) | code |
| `5334dea159` | feat(owp): Upstream-deleted module stubs | `packages/coding-agent/src/edit/file-read-cache.ts`, `packages/coding-agent/src/edit/hashline/diff.ts`, `packages/coding-agent/src/edit/hashline/filesystem.ts`, `packages/coding-agent/src/edit/hashline/params.ts` | code |
| `f3ed8f660a` | feat(owp): sync-upstream skill and script | `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/SKILL.md.template`, `.omp/skills/sync-upstream/feature-registry.yaml`, `.omp/skills/sync-upstream/generate-skill-md.ts`, `.omp/skills/sync-upstream/sync.ts` | code |
| `7fe8f601ec` | feat(owp): feature-checklist extension | `.omp/extensions/feature-checklist.ts` | code |
| `5696bd1105` | feat(owp): mise.toml + native rebuild docs | `.omp/commands/sync-upstream.md`, `mise.toml` | code |
| `06ad5b900f` | feat(owp): Bazel build config (hermetic PATH, crate annotations) | `.bazelrc`, `MODULE.bazel` | code |
| `1374b7fd2e` | feat(owp): Add .gitnexus, .claude/, CLAUDE.md to .gitignore | `.gitignore` | code |
| `2d232fde2b` | feat(owp): Archive skill-group-toggle openspec spec | `openspec/specs/skill-group-toggle/spec.md` | docs only |
| `b74a8fe8a1` | feat(owp): Work around zlob/zig build failure on macOS 26 | `crates/pi-natives/src/summary.rs` | code |
| `1908951afa` | feat(owp): OWP workspace and plans | `.omp/extensions/ask-mode-guard.ts`, `.omp/extensions/plan-report/package.json`, `.omp/extensions/plan-report/plan-report.ts`, `.omp/plans/PLAN_LOAD_SUBCOMMAND_PLAN.md`, `.omp/plans/add_sync_upstream_rollback_tracking_and_persistent_pre_sync_state.md`, … (8 more) | code |
| `e905c76c28` | feat(owp): OWP skills | `.omp/skills/google-ai-research/SKILL.md`, `.omp/skills/onboard-provider/SKILL.md`, `.omp/skills/onboard-provider/probe-provider.ts`, `.omp/skills/skill-installer/SKILL.md`, `.omp/skills/tmux-debug/SKILL.md` | code |
| `bc0327a22c` | feat(owp): OWP documentation | `docs/ask_session.md`, `docs/bugs/ask-mode-switch-tool-missing.md`, `docs/bugs/debug-mode-lifecycle.md`, `docs/bugs/edit-tool-session-gaps.md`, `docs/bugs/explore-subagent-connection-error.md`, … (6 more) | docs only |
| `9bd58916b3` | feat(owp): OWP spec docs | `openspec/config.yaml`, `openspec/specs/ask-mode/spec.md`, `openspec/specs/debug-mode/spec.md`, `openspec/specs/dual-mode-extension-loader/spec.md`, `openspec/specs/install-binary-command/spec.md`, … (4 more) | docs only |
| `b422649da6` | feat(owp): OWP AI package | `packages/ai/package.json`, `packages/ai/src/cli.ts`, `packages/ai/src/index.ts`, `packages/ai/src/stream.ts`, `packages/ai/src/utils/h2-fetch.ts`, … (6 more) | code |
| `ca9475b6a7` | feat(owp): OWP agent package | `packages/agent/src/append-only-context.ts`, `packages/agent/test/otel.test.ts` | code |
| `d96fa4493d` | feat(owp): OWP coding-agent package | `packages/coding-agent/scripts/legacy-pi-virtual-module.ts`, `packages/coding-agent/src/cli-commands.ts`, `packages/coding-agent/src/cli/command-help.ts`, `packages/coding-agent/src/commands/install.ts`, `packages/coding-agent/src/config/file-lock.ts`, … (112 more) | code |
| `caefb5387b` | feat(owp): OWP natives package | `packages/natives/native/embedded-addon.js`, `packages/natives/native/index.d.ts`, `packages/natives/native/loader-state.js`, `packages/natives/scripts/embed-native.ts`, `packages/natives/test/windows-staging.test.ts` | code |
| `1eb5336e28` | feat(owp): OWP stats package | `packages/stats/src/aggregator.ts`, `packages/stats/src/db.ts` | code |
| `126a6df2a6` | feat(owp): OWP TUI package | `packages/tui/src/autocomplete.ts`, `packages/tui/src/components/settings-list.ts`, `packages/tui/src/symbols.ts`, `packages/tui/src/terminal.ts`, `packages/tui/src/utils.ts`, … (2 more) | code |
| `b67e1f25d6` | feat(owp): OWP utils package | `packages/utils/src/fetch-retry.ts` | code |
| `c0687735c3` | feat(owp): OWP scripts | `scripts/eval-bench-runs.ts`, `scripts/session-stats/README.md` | code |
| `d12d83a93e` | chore(owp): retain prefer-ours divergence files | `python/robomp/src/static/assets/index-D-1YFgui.js`, `python/robomp/src/static/assets/style-B9LxyhOi.css`, `python/robomp/src/static/index.html` | chore |
| `afad87a9e7` | chore(owp): remove python/robomp/ — fork does not ship robomp | `python/robomp/.env.example`, `python/robomp/.gitignore`, `python/robomp/AGENTS.md`, `python/robomp/README.md`, `python/robomp/assets/icon.jpg`, … (73 more) | chore |
| `f9c4c18c2c` | chore(owp): remove packages/coding-agent/test/ — chore(owp): remove upstream-only components | `packages/coding-agent/test/auth-broker-import.test.ts`, `packages/coding-agent/test/compaction-prefer-current-model.test.ts`, `packages/coding-agent/test/debug/raw-sse-pretty.test.ts`, `packages/coding-agent/test/discovery/builtin-rules-md.test.ts`, `packages/coding-agent/test/discovery/omp-plugins.test.ts`, … (47 more) | chore |
| `5aebeef785` | chore(owp): remove packages/utils/test/ — chore(owp): remove upstream-only components | `packages/utils/test/env.test.ts`, `packages/utils/test/format.test.ts`, `packages/utils/test/install-id.test.ts`, `packages/utils/test/logger-error-serialization.test.ts`, `packages/utils/test/sanitize-text.test.ts` | chore |
| `d10b3badb0` | chore(owp): remove Dockerfile.robomp* — chore(owp): remove upstream-only components | `Dockerfile.robomp`, `Dockerfile.robomp.dockerignore` | chore |
| `38cdb28f19` | chore(owp): remove Dockerfile.dockerignore — chore(owp): remove upstream-only components | `Dockerfile.dockerignore` | chore |
| `981c40b588` | chore(owp): remove packages/agent/test/compaction-error-status.test.ts — chore(owp): remove upstream-only components | `packages/agent/test/compaction-error-status.test.ts` | chore |
| `25117d7405` | chore(owp): remove packages/agent/test/compaction-telemetry.test.ts — chore(owp): remove upstream-only components | `packages/agent/test/compaction-telemetry.test.ts` | chore |
| `2e73dcc8a6` | chore(owp): remove packages/agent/test/compaction-thinking-level.test.ts — chore(owp): remove upstream-only components | `packages/agent/test/compaction-thinking-level.test.ts` | chore |
| `02f69b7361` | chore(owp): remove packages/agent/test/yield.test.ts — chore(owp): remove upstream-only components | `packages/agent/test/yield.test.ts` | chore |
| `e649097b81` | chore(owp): remove packages/hashline/README.md — chore(owp): remove upstream-only components | `packages/hashline/README.md` | chore |
| `185fd7ee17` | chore(owp): remove packages/hashline/tsconfig.publish.json — chore(owp): remove upstream-only components | `packages/hashline/tsconfig.publish.json` | chore |
| `1dbe7f1ef4` | chore(owp): remove packages/hashline/bench/recovery-session-chain.ts — chore(owp): remove upstream-only components | `packages/hashline/bench/recovery-session-chain.ts` | chore |
| `feac714a2d` | chore(owp): remove packages/hashline/test/format-v2.test.ts — chore(owp): remove upstream-only components | `packages/hashline/test/format-v2.test.ts` | chore |
| `8e659dc1e4` | chore(owp): remove packages/hashline/test/recovery-session-chain.test.ts — chore(owp): remove upstream-only components | `packages/hashline/test/recovery-session-chain.test.ts` | chore |
| `0268a04472` | chore(owp): remove packages/hashline/test/snapshots.test.ts — chore(owp): remove upstream-only components | `packages/hashline/test/snapshots.test.ts` | chore |
| `9cb32e2523` | chore(owp): remove packages/coding-agent/examples/sdk/12-redis-sessions.ts — chore(owp): remove upstream-only components | `packages/coding-agent/examples/sdk/12-redis-sessions.ts` | chore |
| `15e2a84349` | chore(owp): remove packages/coding-agent/examples/sdk/13-sql-sessions.ts — chore(owp): remove upstream-only components | `packages/coding-agent/examples/sdk/13-sql-sessions.ts` | chore |
| `8e995cd06d` | chore(owp): remove packages/catalog/test/google-vertex-discovery.test.ts — chore(owp): remove upstream-only components | `packages/catalog/test/google-vertex-discovery.test.ts` | chore |
| `ef6eda1dbc` | chore(owp): remove packages/catalog/test/wafer.test.ts — chore(owp): remove upstream-only components | `packages/catalog/test/wafer.test.ts` | chore |
| `3598580763` | docs(owp): update Last Sync Point to eab72e88e4 (18.0.4) | `docs/maintaining-owp-fork.md` | docs only |

> **Note:** Generated from `git log upstream/main..main`. Commit hashes change on every rebase — refresh this table by running `bun .omp/skills/sync-upstream/generate-skill-md.ts`, never by hand.
<!-- GENERATED:fork-commits:end -->

## Owned Symbols in Shared Files

The sync-upstream skill (`.omp/skills/sync-upstream/SKILL.md § Owned Symbols`) maintains the
authoritative symbol-level ownership registry. During rebase, conflicts in shared files must
preserve these specific symbols rather than taking wholesale blocks.

The most conflict-prone file is `sdk.ts`. OWP owns these symbols inside it:
- `makeSkillDiscoverer()` — skill rediscovery factory
- `skillsOverride` param in `rebuildSystemPrompt` — allows override on /new
- `disabledExtensions` spread in `skillsSettings` — threads ECC toggles
- `let sessionManager` — allows session_directory handler override
- `customPrompt: options.systemPrompt` — custom prompt in string-typed branch only

---

## Upstream Bug Fixes (Pending Upstream PR)

Bugs fixed in owp that also exist in omp. These commits should be upstreamed. During sync, if upstream fixes the same bug differently, prefer upstream and drop our commit.

| Commit | Bug | Upstream status |
|--------|-----|-----------------|
| `2e3c147c2` (upstream) | `installer.ts` uses `getAgentDir()` instead of `getPluginsDir()`, causing all plugin install/uninstall to operate on `~/.omp/agent/plugins` instead of `~/.omp/plugins`. | **Fixed upstream** — owp will pick this up on next rebase. |

Note: the `getAgentDir()` vs `getPluginsDir()` bug is latent in omp too (both resolve to `~/.omp/plugins` on stock omp since `agentDir == ~/.omp`), but becomes visible in owp where `agentDir == ~/.omp/agent`. An earlier owp commit attempted to fix this (`b396419d1`, now lost to history rebuild) but upstream independently landed `2e3c147c2`. The `@oh-my-pi/*` / `@mariozechner/*` symlink injection fix is owp-specific (package rename) and not upstream.


---

## Sync Workflow

Use `.omp/commands/sync-upstream.md` to trigger the sync (LLM agent or manual).

### Step 1: Run sync.ts

The sync script handles fetch, rebase, conflict reporting, type-check, and optional push:

```bash
bun .omp/skills/sync-upstream/sync.ts --push
```

Run without `--push` for a dry run that shows what would happen. During rebase, the agent resolves conflicts using the decision tree below.

To create backup tags (pre-sync and post-sync) as remote rollback points:

```bash
bun .omp/skills/sync-upstream/sync.ts --push --tag
```

If the rebase stops with conflicts, resolve them, `git add`, then continue:

```bash
bun .omp/skills/sync-upstream/sync.ts --continue --push
```

To abort an in-progress rebase:

```bash
git rebase --abort
```

To check the last sync attempt or revert to the pre-sync HEAD:

```bash
bun .omp/skills/sync-upstream/sync.ts --status
bun .omp/skills/sync-upstream/sync.ts --revert
```

To roll back a pushed sync using a pre-sync tag:

```bash
git reset --hard sync/base/2026-06-01  # replace with actual tag
git push origin main --force-with-lease
```

### Step 2: Rebuild native addon

Always rebuild the native addon after a version bump, because `Cargo.toml` / `package.json` bumps change the `__piNativesV{major}_{minor}_{patch}` sentinel that `loader-state.js` validates at load-time. A stale `.node` file embeds the old sentinel and the compiled binary dies with `does not expose the ... version sentinel`.

```bash
mise exec -- bun --cwd=packages/natives run build
```

Verify the sentinel is correct:

```bash
strings packages/natives/native/pi_natives.*.node | grep "__piNativesV"
# must match: __piNativesV<major>_<minor>_<patch> where <major>.<minor>.<patch> == package.json#version
```

Native dependencies (e.g. `zig` for MiMalloc/zlob) are managed via `mise.toml` — run `mise install` once if the build fails due to a missing tool.

### Step 3: Verify compilation

```bash
bun check:ts
```

If type errors, the agent escalates rather than pushing.

### Step 4: Verify config compatibility

After the code changes, verify your local omp config is still valid against the new schema:

```bash
omp --validate-config 2>/dev/null || omp --help > /dev/null
```

Or simply start omp and check for schema errors in the startup output. If you see:

```
Failed to load config file models, Schema error: ...
```

The schema for `~/.omp/agent/models.yml` changed upstream. Common cases:

- A `discovery.type` value you configured is no longer valid (or was never valid) — check the current allowed values in `src/config/model-registry.ts` → `ProviderDiscoverySchema`
- A new required field was added to a provider config

Fix `~/.omp/agent/models.yml` to match the current schema before proceeding.

### Step 5: Force-push (with safety)

```bash
git push origin main --force-with-lease
```

This atomically updates `fork/main` and resets any open feature branches' merge bases.

---

## Conflict Resolution Decision Tree

When `git rebase` hits a conflict, the agent applies this logic:

```
Is the file in "Owned Files" (§ Fork Features)?
  → YES: Prefer ours, verify compilation
  → NO: Continue below

Is the conflicting hunk inside a shared file with owp-owned symbols (§ Owned Symbols)?
  → YES: Take upstream's structure, graft in owp-owned symbols, verify all survive
  → NO: Continue below

Is upstream's change a rename/refactor of something we depend on?
  → YES: Adapt ours to the new shape, verify compilation
  → NO: Continue below

Is upstream's change altering the *semantics* of an interface we depend on?
  (E.g., changing return type contract, removing a mode, restructuring data flow)
  → YES: Escalate to user ("upstream changed X; your feature Y depends on it—adapt or drop?")
  → NO: Continue below

Is the file in "Skip These Upstream Features" (§15 in porting-from-pi-mono.md)?
  → YES: Prefer upstream (we don't own it)
  → NO: Prefer upstream (benefit from upstream's work)

Result: Take upstream, verify compilation
```

### Examples

**Trivial (auto-resolve):**
- Upstream renames a utility function we call → update call site, compile
- Upstream adds a new field to a shared type we inherit from → update our consumer, compile
- Upstream reformats an unrelated file → prefer upstream
- Upstream adds a feature in a file we don't touch → prefer upstream

**Semantic (escalate to user):**
- Upstream rewrites `scanSkillsFromDir(...)` to return a different contract, incompatible with our skill grouping feature
- Upstream removes the `extensibility` system we depend on for ask/debug mode
- Upstream changes the semantics of "disabled extensions" in a way that breaks our group toggle


> **Empty commits during rebase:** If a commit from owp becomes empty during rebase, git drops it silently. This happens when upstream independently applied the same bug fix. Our "Upstream Bug Fixes (Pending Upstream PR)" table tracks these. If a commit disappears, verify its change is present in upstream's code before proceeding.
---

## Tracking Upstream-Obsoleted Fixes

When upstream independently applies the same bug fix that owp previously carried, the owp commit becomes empty during rebase and git silently drops it. By default `sync.ts` warns about every dropped commit because it could also mean a feature was accidentally lost. For commits that are *expected* to disappear, the feature registry can suppress the false-positive warning.

### Why this exists

Without tracking, every sync produces a warning like:

```
⚠️  WARNING: Commit abc1234 became empty and was dropped by rebase.
```
The agent then has to manually verify that the change is present upstream. For fixes that upstream clearly obsoleted, this manual check is pure overhead and trains the agent to ignore warnings. Tracking them makes the warning signal noisy-free.

### How to add an entry

1. Identify the pre-rebase hash of the dropped commit (from `git log upstream/main..main` before the next rebase, or from `git reflog`).
2. Find the upstream commit that made the fix unnecessary (e.g., `git log upstream/main --grep="..."` or browsing upstream history).
3. Open `.omp/skills/sync-upstream/feature-registry.yaml`.
4. On the feature that owns the fix, add an `obsoleted_fixes` array entry:

   ```yaml
   - name: "Fix isBunBinary in compiled binary"
     owned_paths:
       - "packages/coding-agent/src/config.ts"
     obsoleted_fixes:
       - pre_rebase_hash: "a1b2c3d4e5f6..."
         description: "Corrected isBunBinary check for compiled binaries"
         upstream_obsoleted_in: "deadbeef1234..."
   ```
5. Regenerate `SKILL.md`:
   ```bash
   bun .omp/skills/sync-upstream/generate-skill-md.ts
   ```

### How sync.ts uses it

During the empty-commit check (`sync.ts` § Rebase), the script builds a `Set<string>` of all `pre_rebase_hash` values from every feature's `obsoleted_fixes`. If a dropped commit hash matches a tracked obsoleted fix, the script prints an informational message instead of the warning:

```
ℹ️  Commit abc1234 was dropped by rebase (expected — tracked as obsoleted fix).
```

If a commit drops and is **not** in the set, the full warning is still emitted so the agent investigates.

---

## Implementing New Features

### Design for rebase survival

Features that own their own files rebase cleanly. Features that scatter inline code through
`sdk.ts` conflict on every sync. Before implementing:

- **Put logic in new files** under `src/modes/`, `src/config/`, or `src/capability/`.
  Import and call from the minimum number of shared callsites.
- **Minimize sdk.ts surface.** One import + one constructor arg = one conflict hunk.
  Six scattered additions = six conflict hunks.
- **Extend shared types, don't fork them.** Add literals to existing unions rather than
  creating parallel types.
- **Use extension hooks** when they exist (event handlers, extensionRunner).
- **Update the feature registry** in `.omp/skills/sync-upstream/feature-registry.yaml` in the same
  commit that touches shared files. This is the single source of truth; both `sync.ts` and the
  generated `SKILL.md` consume it. After editing the YAML, regenerate `SKILL.md`:
  ```bash
  bun .omp/skills/sync-upstream/generate-skill-md.ts
  ```

### Git workflow

1. Create a feature branch off upstream/main:
   ```bash
   git fetch upstream
   git checkout -b feat/my-feature upstream/main
   # ... implement
   git push origin feat/my-feature
   ```

2. Open a PR to fork/main. Merge strategy: **squash**.

3. After merge, run `bun .omp/skills/sync-upstream/generate-skill-md.ts` to regenerate the Fork Features table from git history.

4. Audit the contact surface:
   - How many hunks does this commit add to sdk.ts?
   - What shared-file symbols does it own? (add to `feature-registry.yaml` § owned_symbols)
   - Are all owned files listed in `feature-registry.yaml` § features?
     Run `bun .omp/skills/sync-upstream/sync.ts --dry-run` to confirm no unregistered files.

---

## Handling Open PRs During Sync

If you have open feature branches:

1. The rebase of `fork/main` doesn't touch them initially
2. After `fork/main` is updated, each feature branch's merge base moves
3. The agent or you can rebase the feature branch against the new `upstream/main`:
   ```bash
   git rebase upstream/main feat/my-next-feature
   ```

This is independent of the `fork/main` rebase — no conflicts propagate.

---

## Keeping Identity Safe

The identity commit (`0ab96c1da`, README fork marker) must survive every rebase. It owns `README.md` only.

**If upstream changes README:**
- Rebase conflict on README
- Agent takes upstream version, then cherry-picks the identity commit's README changes back on top
- Or: agent takes ours, then manually syncs any substantial upstream README changes
- Document the choice in the commit message

---

## What If a Feature Breaks After Sync?

If `bun check:ts` fails after rebase:

1. The agent does not push
2. The agent either:
   - Fixes the conflict and re-checks (if it's a trivial shape mismatch), or
   - Escalates to you with the error and the conflicted files

3. You resolve the issue, verify `bun check:ts` again, then manually push:
   ```bash
   git push origin main --force-with-lease
   ```

---

## Sync Frequency

Recommend weekly syncs or before each feature launch. omp moves fast (~17 commits/day), so waiting >2 weeks risks larger conflict surface.

Monitor upstream for major refactors or breaking changes in your owned files/interfaces. The porting doc `§15` helps the agent recognize these.

---

## Rollback

If a sync goes wrong, use the automatic revert before pushing:

```bash
bun .omp/skills/sync-upstream/sync.ts --revert
```

This resets `fork/main` to the exact pre-sync commit recorded in `~/.omp/sync-state.json`. It only works if the sync was not yet marked `completed`; completed syncs must be reverted manually to avoid accidentally discarding upstream changes.

Check sync history anytime:

```bash
bun .omp/skills/sync-upstream/sync.ts --status
```

Manual fallback:

```bash
git rebase --abort          # during rebase
git reset --hard ORIG_HEAD  # after a bad rebase completed (if you didn't push)
git push origin main --force-with-lease
```

The append-only log at `~/.omp/sync-log.jsonl` records every attempt, so you can correlate regression patterns with specific upstream bases. Feature branches are unaffected by revert; they still have their old merge base. Re-run the sync when ready.

---

## Reference: omp Intentional Divergences

From `docs/porting-from-pi-mono.md §15`. **owp should not override these** during sync:

- `StatusLineComponent` instead of `FooterDataProvider`
- `.omp/` namespace instead of `.pi/`
- Multi-credential auth with round-robin instead of single-credential
- Capability-based discovery system
- MCP/Exa/SSH integrations
- LSP writethrough
- Bash interception

If upstream changes one of these, escalate to user.

---

## Monitoring & Escalation Checklist

**Before sync:**
- [ ] Check upstream's recent commits for changes to your owned files
- [ ] Read any recent CHANGELOG entries in omp for breaking changes

**During sync:**
- [ ] Agent logs all conflicts and resolutions
- [ ] If `packages/natives/` or `crates/` changed: rebuild native addon (`mise exec -- bun --cwd=packages/natives run build`)
- [ ] After conflict resolution: `grep -rn '<<<<<<' packages/` returns no results
- [ ] After conflict resolution: `bunx tsgo -p tsconfig.json --noEmit` has no NEW errors
- [ ] After conflict resolution: all owp-owned symbols verified present (see § Owned Symbols)
- [ ] If owp deps were added: `bun install` run and bun.lock committed
- [ ] Type check passes before push
- [ ] Identity commit still present on main

---

## Asking for Help

If the sync agent escalates:

1. Read the escalation message and conflicted files
2. Decide: adapt your feature or drop the upstream change?
3. Resolve manually, then push

If stuck, refer to:
- Your feature's commit message (describes intent and dependencies)
- This doc's decision tree
- `docs/porting-from-pi-mono.md` for omp's own policies
