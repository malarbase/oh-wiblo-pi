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

**Upstream base:** `b4e8e856ad` (latest upstream/main)
**Date:** 2026-08-26
**omp commits since:** ~17 (18.0.4 → 18.0.6)
To generate patches for your next sync:
```bash
git format-patch b4e8e856ad40294167679a3f88417c07429fe59b..upstream/main
```

Update this section after each successful rebase.

---

## Fork Features (Curated Stack)

> fork/main is a linear stack of fork commits on top of `upstream/main`. The table below is **generated** from git history by `forklift render` — do not edit it by hand; run the command instead.

<!-- GENERATED:fork-commits:start -->
Total: 108 fork commits on top of `upstream/main..main`.

| Commit | Feature | Owned Files | Status |
|--------|---------|------------|--------|
| `865ec3be0b` | feat(owp): Identity | `README.md` | docs only |
| `3c05496337` | feat(owp): Ask mode | `packages/coding-agent/src/modes/ask-mode/ask-mode-guard.ts`, `packages/coding-agent/src/modes/ask-mode/bash-readonly.ts`, `packages/coding-agent/src/modes/ask-mode/readonly-tools.ts`, `packages/coding-agent/src/modes/ask-mode/state.ts`, `packages/coding-agent/src/modes/ask-mode/tool-guard.ts`, … (3 more) | code |
| `2cded52c61` | feat(owp): Debug mode | `packages/coding-agent/src/modes/debug-mode/log-server.ts`, `packages/coding-agent/src/modes/debug-mode/state.ts`, `packages/coding-agent/src/prompts/system/debug-mode-context.md` | code |
| `9e57f675be` | feat(owp): Local discovery + two-level scan | `packages/coding-agent/src/discovery/helpers.ts`, `packages/coding-agent/src/discovery/pi.ts` | code |
| `020da5ac97` | feat(owp): Skill grouping | `packages/coding-agent/src/capability/skill.ts`, `packages/coding-agent/src/modes/components/extensions/state-manager.ts` | code |
| `15c5de2b38` | feat(owp): baseUrl resolution | `packages/coding-agent/src/config/model-registry.ts` | code |
| `851dc625f3` | feat(owp): Google search provider | `packages/coding-agent/src/config/settings-schema.ts`, `packages/coding-agent/src/web/search/providers/google-ai.ts`, `packages/coding-agent/src/web/search/providers/google.ts` | code |
| `b3b395fa6b` | feat(owp): SerpAPI search provider | `packages/coding-agent/src/web/search/provider.ts`, `packages/coding-agent/src/web/search/providers/serpapi.ts`, `packages/coding-agent/src/web/search/types.ts` | code |
| `4d3e49d07c` | feat(owp): Plan mode /plan load | `packages/coding-agent/src/plan-mode/approved-plan.ts`, `packages/coding-agent/src/plan-mode/resolve-handler.ts`, `packages/coding-agent/src/plan-mode/state.ts`, `packages/coding-agent/src/plan-mode/storage.ts` | code |
| `6f8bde1d5c` | feat(owp): Plan storage project path fix | `packages/coding-agent/src/modes/interactive-mode.ts` | code |
| `664eb517e0` | feat(owp): Provider onboarding wizard | `packages/coding-agent/src/modes/components/provider-onboarding-wizard.ts` | code |
| `467347c6e9` | feat(owp): @mariozechner/* loader aliases | `packages/coding-agent/src/extensibility/custom-commands/loader.ts`, `packages/coding-agent/src/extensibility/extensions/loader.ts` | code |
| `bc37502bde` | feat(owp): History reorganization tooling | `.omp/commands/reorganize-fork.md`, `.omp/skills/reorganize-history/SKILL.md`, `.omp/skills/reorganize-history/organize.ts` | code |
| `0a4f71e8b0` | feat(owp): Test filter scope fix | `packages/coding-agent/test/utils/filter-user-extensions.ts` | code |
| `46c976c8f4` | feat(owp): Session directory event + jiti loader + authHeader fix | `packages/coding-agent/src/sdk.ts`, `packages/coding-agent/src/session/auth-broker-config.ts` | code |
| `960374d830` | feat(owp): Cache write token tracking + bin/owp switcher | `bin/owp`, `docs/cache-token-tracking.md` | code |
| `d27bebd6c4` | feat(owp): Build dist/owp as primary output | `packages/coding-agent/scripts/build-binary.ts` | code |
| `07ad73e52a` | feat(owp): Fix plan-mode approval UI + omp bin entry + ETXTBSY fix | `packages/coding-agent/package.json`, `packages/coding-agent/src/modes/controllers/event-controller.ts`, `packages/coding-agent/test/tools/bash-interceptor.test.ts` | code |
| `1187cf3c1a` | feat(owp): Google search provider + hashline recovery + mode fixes | `.omp/extensions/pi-peon/config.ts`, `.omp/extensions/pi-peon/index.ts`, `.omp/extensions/pi-peon/install.ts`, `.omp/extensions/pi-peon/pack.ts`, `.omp/extensions/pi-peon/package.json`, … (11 more) | code |
| `84f87435b6` | feat(owp): Upstream-deleted module stubs | `packages/coding-agent/src/edit/file-read-cache.ts`, `packages/coding-agent/src/edit/hashline/diff.ts`, `packages/coding-agent/src/edit/hashline/filesystem.ts`, `packages/coding-agent/src/edit/hashline/params.ts` | code |
| `47dea03ba3` | feat(owp): sync-upstream skill and script | `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/SKILL.md.template`, `.omp/skills/sync-upstream/feature-registry.yaml`, `.omp/skills/sync-upstream/generate-skill-md.ts`, `.omp/skills/sync-upstream/sync.ts` | code |
| `83a4e6593f` | feat(owp): feature-checklist extension | `.omp/extensions/feature-checklist.ts` | code |
| `c3c7c32921` | feat(owp): mise.toml + native rebuild docs | `.omp/commands/sync-upstream.md`, `mise.toml` | code |
| `bdafedf328` | feat(owp): Bazel build config (hermetic PATH, crate annotations) | `.bazelrc`, `MODULE.bazel` | code |
| `61e380a354` | feat(owp): Add .gitnexus, .claude/, CLAUDE.md to .gitignore | `.gitignore` | code |
| `b747cc19f7` | feat(owp): MiMo-Code edit mode | `crates/pi-edit/grammars/mimo.ts` | code |
| `cb144b59af` | feat(owp): Archive skill-group-toggle openspec spec | `openspec/specs/skill-group-toggle/spec.md` | docs only |
| `d1b53acf20` | feat(owp): Work around zlob/zig build failure on macOS 26 | `crates/pi-natives/src/summary.rs` | code |
| `d1b5ad290f` | feat(owp): OWP workspace and plans | `.omp/extensions/ask-mode-guard.ts`, `.omp/extensions/plan-report/package.json`, `.omp/extensions/plan-report/plan-report.ts`, `.omp/plans/PLAN_LOAD_SUBCOMMAND_PLAN.md`, `.omp/plans/add_sync_upstream_rollback_tracking_and_persistent_pre_sync_state.md`, … (8 more) | code |
| `468800cc1d` | feat(owp): OWP skills | `.omp/skills/google-ai-research/SKILL.md`, `.omp/skills/onboard-provider/SKILL.md`, `.omp/skills/onboard-provider/probe-provider.ts`, `.omp/skills/skill-installer/SKILL.md`, `.omp/skills/tmux-debug/SKILL.md` | code |
| `aaa41af5be` | feat(owp): OWP documentation | `docs/ask_session.md`, `docs/bugs/ask-mode-switch-tool-missing.md`, `docs/bugs/debug-mode-lifecycle.md`, `docs/bugs/edit-tool-session-gaps.md`, `docs/bugs/explore-subagent-connection-error.md`, … (6 more) | docs only |
| `30c8c51e5d` | feat(owp): OWP spec docs | `openspec/config.yaml`, `openspec/specs/ask-mode/spec.md`, `openspec/specs/debug-mode/spec.md`, `openspec/specs/dual-mode-extension-loader/spec.md`, `openspec/specs/install-binary-command/spec.md`, … (4 more) | docs only |
| `1cb2596dc2` | feat(owp): OWP AI package | `packages/ai/src/cli.ts`, `packages/ai/src/index.ts`, `packages/ai/src/stream.ts`, `packages/ai/src/utils/h2-fetch.ts`, `packages/ai/src/utils/schema/normalize-cca.ts`, … (5 more) | code |
| `315407e148` | feat(owp): OWP agent package | `packages/agent/src/append-only-context.ts`, `packages/agent/test/otel.test.ts` | code |
| `ed42f80ef5` | feat(owp): OWP coding-agent package | `packages/coding-agent/scripts/legacy-pi-virtual-module.ts`, `packages/coding-agent/src/commands/install.ts`, `packages/coding-agent/src/config/file-lock.ts`, `packages/coding-agent/src/config/model-discovery.ts`, `packages/coding-agent/src/config/models-config-schema-bundle.ts`, … (93 more) | code |
| `a55b637664` | feat(owp): OWP natives package | `packages/natives/native/embedded-addon.js`, `packages/natives/native/index.d.ts`, `packages/natives/native/loader-state.js`, `packages/natives/scripts/embed-native.ts`, `packages/natives/test/windows-staging.test.ts` | code |
| `7dbe0ccb66` | feat(owp): OWP stats package | `packages/stats/src/aggregator.ts`, `packages/stats/src/db.ts` | code |
| `26301a1d33` | feat(owp): OWP TUI package | `packages/tui/src/app-keybindings.ts`, `packages/tui/src/autocomplete.ts`, `packages/tui/src/components/settings-list.ts`, `packages/tui/src/overlays/extensions/extension-list.ts`, `packages/tui/src/overlays/extensions/extension-list.ts.bak`, … (14 more) | code |
| `30fe14abbf` | feat(owp): OWP scripts | `scripts/eval-bench-runs.ts`, `scripts/session-stats/README.md` | code |
| `2cccb2c80b` | chore(owp): retain prefer-ours divergence files | `packages/hashline/LICENSE`, `packages/hashline/README.md`, `packages/hashline/bench/recovery-session-chain.ts`, `packages/hashline/package.json`, `packages/hashline/src/apply.ts`, … (38 more) | chore |
| `053bfd5e43` | chore(owp): remove python/robomp/ — fork does not ship robomp | `python/robomp/.env.example`, `python/robomp/.gitignore`, `python/robomp/AGENTS.md`, `python/robomp/README.md`, `python/robomp/assets/icon.jpg`, … (73 more) | chore |
| `5c18fb8546` | chore(owp): remove packages/coding-agent/test/ — chore(owp): remove upstream-only components | `packages/coding-agent/test/auth-broker-import.test.ts`, `packages/coding-agent/test/compaction-prefer-current-model.test.ts`, `packages/coding-agent/test/discovery/builtin-rules-md.test.ts`, `packages/coding-agent/test/discovery/omp-plugins.test.ts`, `packages/coding-agent/test/edit-patch-unchanged-error.test.ts`, … (40 more) | chore |
| `c8198d9ea8` | chore(owp): remove packages/utils/test/ — chore(owp): remove upstream-only components | `packages/utils/test/env.test.ts`, `packages/utils/test/format.test.ts`, `packages/utils/test/install-id.test.ts`, `packages/utils/test/logger-error-serialization.test.ts`, `packages/utils/test/sanitize-text.test.ts` | chore |
| `596e6689d1` | chore(owp): remove Dockerfile.robomp* — chore(owp): remove upstream-only components | `Dockerfile.robomp`, `Dockerfile.robomp.dockerignore` | chore |
| `f947e0eeab` | chore(owp): remove Dockerfile.dockerignore — chore(owp): remove upstream-only components | `Dockerfile.dockerignore` | chore |
| `c230ada3d9` | chore(owp): remove packages/agent/test/compaction-error-status.test.ts — chore(owp): remove upstream-only components | `packages/agent/test/compaction-error-status.test.ts` | chore |
| `f255e83887` | chore(owp): remove packages/agent/test/compaction-telemetry.test.ts — chore(owp): remove upstream-only components | `packages/agent/test/compaction-telemetry.test.ts` | chore |
| `d47a19e4be` | chore(owp): remove packages/agent/test/compaction-thinking-level.test.ts — chore(owp): remove upstream-only components | `packages/agent/test/compaction-thinking-level.test.ts` | chore |
| `8c7bdb154e` | chore(owp): remove packages/agent/test/yield.test.ts — chore(owp): remove upstream-only components | `packages/agent/test/yield.test.ts` | chore |
| `91ed8c2f9a` | chore(owp): remove packages/coding-agent/examples/sdk/12-redis-sessions.ts — chore(owp): remove upstream-only components | `packages/coding-agent/examples/sdk/12-redis-sessions.ts` | chore |
| `3ee85a7558` | chore(owp): remove packages/coding-agent/examples/sdk/13-sql-sessions.ts — chore(owp): remove upstream-only components | `packages/coding-agent/examples/sdk/13-sql-sessions.ts` | chore |
| `a5548ffd6b` | chore(owp): remove packages/catalog/test/google-vertex-discovery.test.ts — chore(owp): remove upstream-only components | `packages/catalog/test/google-vertex-discovery.test.ts` | chore |
| `6009578013` | chore(owp): remove packages/catalog/test/wafer.test.ts — chore(owp): remove upstream-only components | `packages/catalog/test/wafer.test.ts` | chore |
| `e453f2da69` | chore(owp): remove packages/tui/test/emoji-autocomplete.test.ts — chore(owp): remove upstream-only components | `packages/tui/test/emoji-autocomplete.test.ts` | chore |
| `b00e2288a9` | chore(owp): remove packages/tui/test/hyperlink.test.ts — chore(owp): remove upstream-only components | `packages/tui/test/hyperlink.test.ts` | chore |
| `38d360101d` | chore(owp): remove packages/tui/test/raw-sse-pretty.test.ts — chore(owp): remove upstream-only components | `packages/tui/test/raw-sse-pretty.test.ts` | chore |
| `e7487be09a` | chore(owp): remove packages/tui/test/settings-list-theme.test.ts — chore(owp): remove upstream-only components | `packages/tui/test/settings-list-theme.test.ts` | chore |
| `6616073269` | chore(owp): remove packages/tui/test/shimmer.test.ts — chore(owp): remove upstream-only components | `packages/tui/test/shimmer.test.ts` | chore |
| `72f08c2706` | chore(owp): remove packages/tui/test/status-line-cache-hit.test.ts — chore(owp): remove upstream-only components | `packages/tui/test/status-line-cache-hit.test.ts` | chore |
| `17c18bbecf` | chore(owp): remove packages/tui/test/task-nested-live-render.test.ts — chore(owp): remove upstream-only components | `packages/tui/test/task-nested-live-render.test.ts` | chore |
| `d3d06ec9d8` | chore(owp): reconcile bun.lock after rebuild (hashline workspace + owp bin) | `bun.lock` | chore |
| `5a740e1869` | fix(owp): repair bad-merge artifacts inherited from pre-rebase tree | `packages/coding-agent/src/session/agent-session.ts`, `packages/coding-agent/test/settings-manager.test.ts`, `packages/coding-agent/test/tools/index.test.ts`, `packages/tui/src/overlays/extensions/extension-list.ts.bak` | code |
| `3109cfffce` | style(owp): oxfmt files inherited unformatted from pre-rebase tree | `packages/coding-agent/src/edit/modes/apply-patch.ts`, `packages/coding-agent/src/internal-urls/docs-index.generated.ts`, `packages/coding-agent/src/modes/controllers/event-controller.ts`, `packages/coding-agent/src/session/agent-session.ts`, `packages/coding-agent/test/modes/interactive-mode/handle-switch-mode-noop.test.ts`, … (2 more) | code |
| `7e5bfd1d26` | fix(coding-agent): repair runtime seams after history rebuild | `packages/coding-agent/src/edit/apply-patch/index.ts`, `packages/coding-agent/src/edit/apply-patch/parser.ts`, `packages/coding-agent/src/edit/blackbox.ts`, `packages/coding-agent/src/edit/diff.ts`, `packages/coding-agent/src/edit/edit-clipboard.ts`, … (49 more) | code |
| `006af00eb4` | fix(owp): reconcile fork type surface and test seams after rebuild | `packages/coding-agent/src/cli/gallery-fixtures/segments.ts`, `packages/coding-agent/src/config/settings-schema.ts`, `packages/coding-agent/src/edit/file-snapshot-store.ts`, `packages/coding-agent/src/edit/hashline/diff.ts`, `packages/coding-agent/src/edit/hashline/filesystem.ts`, … (34 more) | code |
| `452876d13b` | fix(coding-agent): replace fragile runtime require() shims with static imports | `packages/coding-agent/src/modes/controllers/selector-controller.ts` | code |
| `776208b65a` | feat(coding-agent): restore settings layering (project/global scope + revert) | `packages/coding-agent/src/config/settings-ui.ts`, `packages/coding-agent/src/config/settings.ts`, `packages/tui/src/overlays/settings-defs.ts`, `packages/tui/src/overlays/settings-selector.ts` | code |
| `dfdb2f5277` | feat(owp): rebuild sync verification net — real commit survival, protecting tests, footprint | `.omp/skills/sync-upstream/feature-registry.yaml`, `.omp/skills/sync-upstream/footprint-baseline.json`, `.omp/skills/sync-upstream/sync.ts` | code |
| `1ef85e092c` | feat(coding-agent): adopt upstream-native edit pipeline, retire JS hashline (Phase B) | `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/feature-registry.yaml`, `.omp/skills/sync-upstream/footprint-baseline.json`, `bun.lock`, `docs/maintaining-owp-fork.md`, … (100 more) | code |
| `64c020a818` | fix(owp): port upstream build+natives sync misses that broke compiled binaries | `packages/coding-agent/CHANGELOG.md`, `packages/coding-agent/scripts/compile-binary.ts`, `packages/natives/native/loader-state.js`, `scripts/ci-release-build-binaries.test.ts` | code |
| `08b7c57c99` | chore(owp): register crates/pi-edit/grammars/mimo.ts, regenerate feature docs | `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/feature-registry.yaml`, `docs/maintaining-owp-fork.md` | chore |
| `9dbf147f9e` | test(owp): retire auth-broker/gateway suites incompatible with fork stubs | `.omp/skills/sync-upstream/feature-registry.yaml`, `packages/coding-agent/test/auth-broker-migrate.test.ts`, `packages/coding-agent/test/auth-broker-snapshot-cache.test.ts`, `packages/coding-agent/test/auth-gateway-account-pool.test.ts`, `packages/coding-agent/test/issue-8096-broker-unreachable-startup.test.ts` | code |
| `50c2137e1c` | fix(coding-agent): restore goal-mode draft images when the handler does not submit | `packages/coding-agent/src/slash-commands/builtin-registry.ts` | code |
| `d60619574c` | feat(coding-agent): add /memory queue and sync verbs | `packages/coding-agent/src/slash-commands/builtin-registry.ts` | code |
| `16f154232b` | chore(owp): register compiled-binary boot-fix ports, refresh fork tables | `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/feature-registry.yaml`, `docs/maintaining-owp-fork.md` | chore |
| `93e09cd0b6` | fix(owp): adopt upstream command composition, restore lost dispatch contracts | `.omp/skills/sync-upstream/feature-registry.yaml`, `packages/coding-agent/src/edit/index.ts`, `packages/coding-agent/src/edit/modes/replace.ts`, `packages/coding-agent/src/modes/controllers/event-controller.ts`, `packages/coding-agent/src/modes/interactive-mode.ts`, … (4 more) | code |
| `9dc5c515ba` | fix(ai): rewrite CLI login to drive registered OAuth providers via AuthStorage.login | `.omp/skills/sync-upstream/feature-registry.yaml`, `packages/ai/src/cli.ts` | code |
| `bba18e42bd` | fix(coding-agent): accept mimo in edit.mode enums so per-model variant configs resolve | `.omp/skills/sync-upstream/feature-registry.yaml`, `packages/coding-agent/src/utils/edit-mode.ts` | code |
| `31f688fee8` | fix(coding-agent): JS mimo edit-description routes before the native table | `.omp/skills/sync-upstream/feature-registry.yaml`, `packages/coding-agent/src/edit/index.ts` | code |
| `99b6988cc2` | fix(owp): resolve plan path from the inlined-plan template; sync extensions | `.omp/extensions/opencode-zen-free-tier.ts`, `.omp/extensions/plan-report/plan-report.ts` | code |
| `44d64fbc08` | fix(owp): resolve plans by their real path; await the binary existence check | `.omp/extensions/opencode-zen-free-tier.ts`, `.omp/extensions/plan-report/plan-report.ts` | code |
| `de187836a3` | fix(coding-agent): restore fork features lost in the Sep 21 history rebuild | `crates/pi-edit/grammars/mimo.ts`, `docs/bugs/debug-mode-lifecycle.md`, `packages/ai/src/stream.ts`, `packages/coding-agent/CHANGELOG.md`, `packages/coding-agent/src/config/settings-schema.ts`, … (28 more) | code |
| `57c6b233e6` | fix(owp): compiled binary boot — drop Bun bytecode, retarget the ESM guard | `docs/bugs/bytecode-childprocess-binding.md`, `packages/coding-agent/CHANGELOG.md`, `packages/coding-agent/scripts/compile-binary.ts`, `scripts/ci-release-build-binaries.test.ts` | code |
| `4e02c62a5b` | chore(owp): refresh robomp web bundle assets | `python/robomp/src/static/assets/index-B0Qocx5T.js`, `python/robomp/src/static/assets/index-BCntletT.js`, `python/robomp/src/static/index.html` | chore |
| `57948acc1c` | chore(owp): repair feature registry against the current tree | `.gitignore`, `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/feature-registry.yaml`, `Dockerfile`, `docs/maintaining-owp-fork.md` | chore |
| `d426c9f600` | fix(coding-agent): make xd:// dispatch failures honest and terminal | `packages/coding-agent/src/tools/xdev.ts`, `packages/coding-agent/test/write-xdev-dispatch.test.ts` | code |
| `e9d6a557c7` | fix(owp): close eleven fork-side test failures, two of them silent behavior regressions | `packages/coding-agent/src/session/prewalk.ts`, `packages/coding-agent/test/agent-session-concurrent.test.ts`, `packages/coding-agent/test/agent-session-plan-mode-convergence.test.ts`, `packages/coding-agent/test/extensibility/legacy-pi-ai-root-exports.test.ts`, `packages/coding-agent/test/tools/bash-interceptor.test.ts`, … (2 more) | code |
| `4b7d8dba57` | test(vibe): restore the stale worker-session fixture and unbind the suspension hang | `packages/coding-agent/test/vibe/vibe-runtime.test.ts` | code |
| `6ebddd85c1` | chore(owp): rebaseline fork commit count and regenerate the fork table | `.omp/skills/sync-upstream/feature-registry.yaml`, `docs/maintaining-owp-fork.md` | chore |
| `d9cdd266cb` | style(owp): oxfmt the Exa abort-test edits | `packages/coding-agent/test/tools/web-search-exa.test.ts` | code |
| `b35781aadd` | chore(owp): rebaseline fork commit count and regenerate the fork table | `.omp/skills/sync-upstream/feature-registry.yaml`, `docs/maintaining-owp-fork.md` | chore |
| `4007419f03` | fix(catalog): bound the haiku budget rule so models.dev slices build | `packages/catalog/src/compat/rules.json`, `packages/catalog/src/compat/rules/classes/anthropic.kdl`, `packages/catalog/test/build.test.ts` | code |
| `53439897cc` | test(catalog): isolate provider tests from the real agent model cache | `packages/catalog/test/generated-policies.test.ts`, `packages/catalog/test/synthetic-provider.test.ts`, `packages/catalog/test/yolo-auto-provider.test.ts` | code |
| `d7acf9ca05` | chore(owp): land the forklift harness — registry, skills, rendered artifacts | `.forklift/README.md`, `.forklift/footprint-baseline.json`, `.forklift/harness.lock`, `.forklift/registry.yaml`, `.omp/plans/done/forklift-bootstrap-plan.done.md`, … (7 more) | chore |
| `3b27b42cec` | chore(owp): rebaseline fork commit count and regenerate the fork table | `.forklift/registry.yaml`, `.omp/skills/sync-upstream/feature-registry.yaml`, `docs/maintaining-owp-fork.md` | chore |
| `70dec9e86b` | chore(owp): register forklift doctor/init skills in the feature registry | `.forklift/registry.yaml`, `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/feature-registry.yaml` | chore |
| `f409191165` | chore(owp): generate AGENT.md and register it as fork-owned | `.forklift/registry.yaml`, `.omp/skills/forklift-doctor/SKILL.md`, `.omp/skills/forklift-init/SKILL.md`, `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/feature-registry.yaml`, … (1 more) | chore |
| `45d420a076` | chore(owp): complete the forklift cutover — retire the legacy sync layer | `.forklift/registry.yaml`, `.omp/commands/reorganize-fork.md`, `.omp/commands/sync-upstream.md`, `.omp/extensions/feature-checklist.ts`, `.omp/rules/owp-feature-registry.md`, … (10 more) | chore |
| `358bf134a8` | chore(owp): render the Conflict Walk into the sync-upstream skill | `.omp/commands/sync-upstream.md`, `.omp/skills/forklift-doctor/SKILL.md`, `.omp/skills/forklift-init/SKILL.md`, `.omp/skills/sync-upstream/SKILL.md`, `docs/maintaining-owp-fork.md` | chore |
| `ed51e2c7d4` | feat(google-ai): gate extraction on answer readiness, not a fixed sleep | `packages/coding-agent/src/modes/interactive-mode.ts`, `packages/coding-agent/src/web/search/providers/google-ai.ts`, `packages/coding-agent/test/interactive-mode-plan-review.test.ts`, `packages/coding-agent/test/tools/web-search-google-ai.test.ts` | code |
| `36c52dfe58` | feat(zen): read the console session token as the free-tier identity | `.forklift/registry.yaml`, `.omp/extensions/opencode-zen-free-tier.ts`, `AGENT.md`, `docs/maintaining-owp-fork.md` | code |
| `8959a77331` | chore(owp): track the forklift install output and npm-publish plans | `.gitignore`, `.omp/plans/Forklift-npm-publish-path-two-small-features.md`, `.omp/plans/done/forklift-npm-publish-plan.done.md`, `.omp/plans/reports/forklift-npm-publish-plan.report.md`, `.omp/skills/forklift-maintain/SKILL.md`, … (1 more) | chore |
| `2fef14e349` | chore(owp): rebaseline the fork commit count to 103 | `.forklift/registry.yaml`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `26758a2386` | chore(owp): register the forklift cutover's deleted and new paths | `.forklift/registry.yaml`, `.omp/skills/sync-upstream/SKILL.md`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `9fbac47879` | chore(owp): register the rendered sync-upstream skill path | `.forklift/registry.yaml`, `.omp/skills/sync-upstream/SKILL.md`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `784e1c3b38` | chore(owp): rebaseline the fork commit count to 106 | `.forklift/registry.yaml`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `2b616a3c75` | chore(owp): acknowledge python/omp-rpc as a deliberate port | `.forklift/registry.yaml`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `pending` | chore(owp): rebaseline the fork commit count to 108 | `.forklift/registry.yaml`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |

> **Note:** Generated from `git log upstream/main..main`. A row whose commit is still `pending` is the newest commit in the range — its hash is unknown until that commit lands, `forklift render` resolves it on the next render. Commit hashes change on every rebase — refresh this table by running `forklift render`, never by hand.
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
forklift sync --push
```

Run without `--push` for a dry run that shows what would happen. During rebase, the agent resolves conflicts using the decision tree below.

To create backup tags (pre-sync and post-sync) as remote rollback points:

```bash
forklift sync --push --tag
```

If the rebase stops with conflicts, resolve them, `git add`, then continue:

```bash
forklift sync --continue --push
```

To abort an in-progress rebase:

```bash
git rebase --abort
```

To check the last sync attempt or revert to the pre-sync HEAD:

```bash
forklift sync --status
forklift sync --revert
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
   forklift render
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
  forklift render
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

3. After merge, run `forklift render` to regenerate the Fork Features table from git history.

4. Audit the contact surface:
   - How many hunks does this commit add to sdk.ts?
   - What shared-file symbols does it own? (add to `feature-registry.yaml` § owned_symbols)
   - Are all owned files listed in `feature-registry.yaml` § features?
     Run `forklift sync --dry-run` to confirm no unregistered files.

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
forklift sync --revert
```

This resets `fork/main` to the exact pre-sync commit recorded in `~/.omp/sync-state.json`. It only works if the sync was not yet marked `completed`; completed syncs must be reverted manually to avoid accidentally discarding upstream changes.

Check sync history anytime:

```bash
forklift sync --status
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
