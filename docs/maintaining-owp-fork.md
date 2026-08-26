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

**Upstream base:** `896bf5f33e` (latest upstream/main)
**Date:** 2026-08-09
**omp commits since:** ~250 (17.2.6 → 17.2.12)
To generate patches for your next sync:
```bash
git format-patch 896bf5f33e..upstream/main
```

Update this section after each successful rebase.

---

## Fork Features (Curated Stack)

> fork/main is a linear stack of fork commits on top of `upstream/main`. The table below is **generated** from git history by `.omp/skills/sync-upstream/generate-skill-md.ts` — do not edit it by hand; run the script instead.

<!-- GENERATED:fork-commits:start -->
Total: 89 fork commits on top of `upstream/main`.

| Commit | Feature | Owned Files | Status |
|--------|---------|------------|--------|
| `359ab74313` | owp: add fork identity marker | `README.md` | docs only |
| `9d21438dca` | feat(owp): add Ask and Debug modes | `packages/coding-agent/src/modes/ask-mode/bash-readonly.ts`, `packages/coding-agent/src/modes/ask-mode/readonly-tools.ts`, `packages/coding-agent/src/modes/ask-mode/state.ts`, `packages/coding-agent/src/modes/ask-mode/tool-guard.ts`, `packages/coding-agent/src/modes/debug-mode/log-server.ts`, … (7 more) | code |
| `c2ace23285` | feat(owp): local discovery and skill grouping infrastructure | `packages/coding-agent/src/capability/skill.ts`, `packages/coding-agent/src/discovery/agents.ts`, `packages/coding-agent/src/discovery/builtin.ts`, `packages/coding-agent/src/discovery/helpers.ts`, `packages/coding-agent/src/discovery/index.ts`, … (8 more) | code |
| `4d25319681` | feat(owp): plan mode /plan load and approval flow | `packages/coding-agent/src/plan-mode/approved-plan.ts`, `packages/coding-agent/src/plan-mode/state.ts`, `packages/coding-agent/src/plan-mode/storage.ts`, `packages/coding-agent/test/plan-mode/approved-plan.test.ts`, `packages/coding-agent/test/plan-mode/plan-mode-resolve.test.ts`, … (3 more) | code |
| `de1e1bf7db` | feat(owp): Google and SerpAPI search providers | `packages/coding-agent/src/config/settings-schema.ts`, `packages/coding-agent/src/hashline/parser.ts`, `packages/coding-agent/src/hashline/recovery.ts`, `packages/coding-agent/src/web/search/provider.ts`, `packages/coding-agent/src/web/search/providers/google-selectors.json`, … (4 more) | code |
| `ef47eba9f9` | feat(owp): provider discovery, baseUrl resolution, and onboarding | `packages/coding-agent/src/modes/components/provider-onboarding-wizard.ts`, `packages/coding-agent/src/modes/components/schema-driven-wizard.ts` | code |
| `381086bfe5` | feat(owp): unified agent mode cycle and status line | `packages/coding-agent/src/modes/components/settings-defs.ts`, `packages/coding-agent/src/modes/components/status-line-segment-editor.ts`, `packages/coding-agent/src/modes/components/status-line/presets.ts`, `packages/coding-agent/src/modes/components/status-line/segments.ts`, `packages/coding-agent/src/modes/components/status-line/types.ts`, … (1 more) | code |
| `60f5bfb9c4` | feat(owp): session directory events and extensibility adaptations | `.omp/settings.json`, `packages/coding-agent/src/extensibility/custom-commands/loader.ts`, `packages/coding-agent/src/extensibility/extensions/loader.ts`, `packages/coding-agent/src/sdk.ts`, `packages/coding-agent/src/session/agent-storage.ts`, … (5 more) | code |
| `affc3f5e6f` | feat(owp): sync-upstream skill, feature checklist, and native workarounds | `.omp/extensions/feature-checklist.ts`, `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/SKILL.md.template`, `.omp/skills/sync-upstream/feature-registry.yaml`, `.omp/skills/sync-upstream/generate-skill-md.ts`, … (2 more) | code |
| `217da93588` | feat(owp): add /install-binary custom command | `.omp/commands/install-binary/index.ts` | code |
| `0ea4fe3771` | feat(owp): cache write token tracking and build fixes | `bin/owp`, `docs/cache-token-tracking.md`, `packages/coding-agent/package.json`, `packages/coding-agent/scripts/build-binary.ts`, `packages/coding-agent/src/config.ts`, … (2 more) | code |
| `3b5826052e` | chore(owp): add OWP workspace configuration | `.omp/extensions/pi-peon/config.ts`, `.omp/extensions/pi-peon/index.ts`, `.omp/extensions/pi-peon/install.ts`, `.omp/extensions/pi-peon/pack.ts`, `.omp/extensions/pi-peon/package.json`, … (8 more) | chore |
| `4e45f9485d` | docs(owp): add OWP skills, commands, documentation, and specs | `.omp/commands/sync-upstream.md`, `.omp/skills/google-ai-research/SKILL.md`, `.omp/skills/owp-developer/SKILL.md`, `.omp/skills/owp-developer/references/auth-resolution-deep-dive.md`, `.omp/skills/owp-developer/references/shell-env-gotchas.md`, … (19 more) | docs only |
| `a2d3a68780` | chore(owp): package-level divergences and workspace updates | `mise.toml`, `packages/agent/src/index.ts`, `packages/agent/src/run-collector.ts`, `packages/agent/test/otel.test.ts`, `packages/ai/src/cli.ts`, … (23 more) | chore |
| `9c659a2eca` | chore(owp): remove upstream-only components | `.omp/skills/sync-upstream/sync.ts`, `Dockerfile.dockerignore`, `Dockerfile.robomp`, `Dockerfile.robomp.dockerignore`, `packages/agent/src/append-only-context.ts`, … (286 more) | chore |
| `82512e99e5` | docs(owp): update Last Sync Point to 304a9346e (2026-05-30) | `docs/maintaining-owp-fork.md` | docs only |
| `1ba1b12ceb` | docs(owp): update Fork Features table and feature registry post-squash | `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/feature-registry.yaml`, `docs/maintaining-owp-fork.md` | docs only |
| `f8a3477c11` | docs(owp): reconstruct Fork Features table with per-commit hashes post-history-rebuild | `docs/maintaining-owp-fork.md` | docs only |
| `8238728c23` | chore(sync): add Dockerfile.dockerignore to feature registry | `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/feature-registry.yaml` | chore |
| `147176bffb` | fix: add stubs for upstream-deleted modules | `packages/agent/src/utils/yield.ts`, `packages/ai/src/providers/google-types.ts`, `packages/coding-agent/src/cli-commands.ts`, `packages/coding-agent/src/config/models-config-writer.ts`, `packages/coding-agent/src/config/schema-introspector.ts`, … (54 more) | code |
| `69681b37dd` | feat(ai): adapt to upstream AI package changes | `packages/ai/src/cli.ts`, `packages/ai/src/utils/schema/adapt.ts`, `packages/ai/src/utils/schema/strict-mode.ts`, `packages/ai/test/anthropic-stream-timeout.test.ts`, `packages/ai/test/openai-codex-stream.test.ts`, … (2 more) | code |
| `413f29a51f` | feat(coding-agent): config, modes, session, and plan-mode adaptations | `docs/plan-mode-resolve-bug.md`, `packages/agent/src/types.ts`, `packages/coding-agent/src/config/keybindings.ts`, `packages/coding-agent/src/config/settings-schema.ts`, `packages/coding-agent/src/extensibility/plugins/loader.ts`, … (24 more) | code |
| `00c2f60ce2` | feat(coding-agent): tools, edit, task, and web adaptations | `packages/coding-agent/src/edit/hashline/block-resolver.ts`, `packages/coding-agent/src/edit/index.ts`, `packages/coding-agent/src/edit/normalize.ts`, `packages/coding-agent/src/edit/streaming.ts`, `packages/coding-agent/src/hashline/parser.ts`, … (8 more) | code |
| `8fa8332aca` | test(coding-agent): update tests for post-rebase adaptations | `bun.lock`, `packages/agent/src/append-only-context.ts`, `packages/agent/src/index.ts`, `packages/agent/src/run-collector.ts`, `packages/agent/src/types.ts`, … (191 more) | code |
| `6f1a8518d1` | feat(skills): add skill-installer skill | `.omp/skills/skill-installer/SKILL.md` | docs only |
| `d2ab7820a7` | feat(commands): sync-upstream skill improvements and install-binary | `.omp/commands/install-binary/index.ts`, `.omp/settings.json`, `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/SKILL.md.template`, `.omp/skills/sync-upstream/feature-registry.yaml`, … (4 more) | code |
| `020e525eb3` | chore(coding-agent): remove dead stubs and update fork docs | `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/feature-registry.yaml`, `docs/maintaining-owp-fork.md`, `packages/coding-agent/src/discovery/omp-extension-roots.ts`, `packages/coding-agent/src/main.ts`, … (2 more) | chore |
| `bcbe7d9a35` | docs(sync): update fork docs and sync-upstream skill with rebase learnings | `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/SKILL.md.template`, `.omp/skills/sync-upstream/feature-registry.yaml`, `docs/maintaining-owp-fork.md` | mixed |
| `bbbffb4e0b` | feat(sync): add --tag flag for pre/post-sync backup tags | `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/SKILL.md.template`, `.omp/skills/sync-upstream/sync.ts`, `docs/maintaining-owp-fork.md` | code |
| `e9b9cd0f98` | fix(google-ai-mode): strip 'You said:' prefix and follow-up prompts from extraction | `packages/coding-agent/src/web/search/providers/google.ts` | code |
| `14d4fdf48a` | fix(pi-natives): resolve version mismatch crash and stale cache issues | `crates/pi-natives/src/summary.rs`, `packages/natives/native/index.d.ts`, `packages/natives/native/index.js`, `packages/natives/native/loader-state.js`, `packages/natives/scripts/embed-native.ts`, … (1 more) | code |
| `3c5d4085b9` | fix(plan-mode): restore standing resolve handler registration in setPlanModeState | `packages/coding-agent/src/session/agent-session.ts` | code |
| `9c489ed2b1` | docs: update plan-mode-resolve-bug.md with Fix 1 regression and restoration | `docs/plan-mode-resolve-bug.md` | docs only |
| `479365c1ec` | fix(settings): prevent onChange from re-populating cleared session-managed settings | `packages/coding-agent/src/session/agent-session.ts` | code |
| `b4c526598d` | fix(commands): bundle /install-binary as a built-in command | `.omp/commands/install-binary/index.ts`, `packages/coding-agent/src/extensibility/custom-commands/bundled/install-binary/index.ts`, `packages/coding-agent/src/extensibility/custom-commands/loader.ts` | code |
| `7103a745be` | docs: update Fork Features table with recent fixes | `docs/maintaining-owp-fork.md` | docs only |
| `3ed063b6d1` | fix(install-binary): suppress success message to avoid LLM turn | `.gitignore`, `packages/coding-agent/src/extensibility/custom-commands/bundled/install-binary/index.ts` | code |
| `96d7d84699` | fix(web-search): thread authStorage through resolveProviderChain to prevent hasAuth crash | `.omp/settings.json`, `docs/maintaining-owp-fork.md`, `packages/coding-agent/CHANGELOG.md`, `packages/coding-agent/src/web/search/provider.ts` | code |
| `2126eb81e8` | docs: update Fork Features table with install-binary and web-search fixes | `docs/maintaining-owp-fork.md` | docs only |
| `47e4fd48c4` | Fix /plan load and /plan run subcommand implementations | `packages/coding-agent/CHANGELOG.md`, `packages/coding-agent/src/modes/interactive-mode.ts`, `packages/coding-agent/src/plan-mode/approved-plan.ts`, `packages/coding-agent/test/plan-mode/plan-run.test.ts` | code |
| `147de06236` | fix(owp): restore lost /refresh-models slash command | `packages/coding-agent/src/slash-commands/builtin-registry.ts` | code |
| `696e288668` | docs(owp): add 9da57050d (/refresh-models restoration) to Fork Features table | `docs/maintaining-owp-fork.md` | docs only |
| `a751ecb150` | fix(hook-input): prefill input with defaultValue instead of discarding it | `packages/coding-agent/src/modes/components/hook-input.ts`, `packages/coding-agent/test/hook-input-timeout.test.ts` | code |
| `348b2ce71f` | feat(tools): replace exit_plan_mode with switch_mode tool | `packages/coding-agent/src/modes/controllers/event-controller.ts`, `packages/coding-agent/src/modes/interactive-mode.ts`, `packages/coding-agent/src/modes/types.ts`, `packages/coding-agent/src/prompts/tools/switch-mode.md`, `packages/coding-agent/src/tools/exit-plan-mode.ts`, … (4 more) | code |
| `9adab6a830` | feat(ask-mode): restore read-only enforcement via in-tool guards | `packages/coding-agent/src/edit/modes/patch.ts`, `packages/coding-agent/src/edit/modes/replace.ts`, `packages/coding-agent/src/modes/ask-mode/ask-mode-guard.ts`, `packages/coding-agent/src/modes/ask-mode/tool-guard.ts`, `packages/coding-agent/src/prompts/system/ask-mode-context.md`, … (8 more) | code |
| `fbb6fa41df` | docs(owp): add mode-registry deferral doc, changelog, exit_plan_mode renames | `docs/mode-registry-future-architecture.md`, `packages/coding-agent/CHANGELOG.md`, `packages/coding-agent/src/config/settings-schema.ts`, `packages/coding-agent/src/plan-mode/approved-plan.ts` | mixed |
| `1e6b51f08a` | docs(owp): replace (pending) row with 4 feature commits in Fork Features table | `docs/maintaining-owp-fork.md` | docs only |
| `dfa74707b7` | docs: consolidate bug docs under docs/bugs/ | `docs/bugs/debug-mode-lifecycle.md`, `docs/bugs/explore-subagent-connection-error.md`, `docs/bugs/plan-mode-resolve-bug.md`, `packages/coding-agent/src/extensibility/custom-commands/bundled/install-binary/index.ts`, `packages/natives/native/index.d.ts` | mixed |
| `99d8498df0` | docs(owp): update Fork Features table with ca67e4504 and 3721320f5 | `docs/maintaining-owp-fork.md` | docs only |
| `e62e3a0e22` | feat(coding-agent): add /add-provider slash command with wizard and persistence | `.omp/plans/plan_extract_owp_fork_features_into_self_contained_plugins_packages.md`, `packages/coding-agent/src/config/models-config-writer.ts`, `packages/coding-agent/src/config/schema-introspector.ts`, `packages/coding-agent/src/config/settings-schema.ts`, `packages/coding-agent/src/extensibility/custom-commands/bundled/install-binary/index.ts`, … (6 more) | code |
| `50abacb791` | fix(plan-mode): respect plan.storage setting in resolve handler | `docs/bugs/edit-tool-session-gaps.md`, `packages/coding-agent/src/plan-mode/resolve-handler.ts`, `packages/coding-agent/src/session/agent-session.ts` | code |
| `a8e66a0992` | docs(owp): update Fork Features table — add 4 missing commits (8a324c9b0, 065da3d9e, eddb2fc29, 5496576de), bump count to ~60 | `docs/maintaining-owp-fork.md` | docs only |
| `32dc31d5c9` | fix(coding-agent): mode context stale instructions, always-available switch_mode, and extensions UI crash | `.omp/plans/fix-mode-context-stale-instructions.md`, `docs/bugs/ask-mode-switch-tool-missing.md`, `docs/maintaining-owp-fork.md`, `packages/coding-agent/src/config/model-registry.ts`, `packages/coding-agent/src/config/models-config-schema-bundle.ts`, … (18 more) | code |
| `19786dbf3e` | feat(coding-agent): add mimo edit mode, streaming edit helpers, and ask/plan extensions | `.omp/extensions/ask-mode-guard.ts`, `.omp/extensions/plan-report/package.json`, `.omp/extensions/plan-report/plan-report.ts`, `packages/coding-agent/src/config/settings-schema.ts`, `packages/coding-agent/src/edit/index.ts`, … (6 more) | code |
| `0a596904da` | docs(sync-upstream): regenerate SKILL.md | `.omp/skills/sync-upstream/SKILL.md` | docs only |
| `0e3c651274` | fix(plan-mode): fix proposal handler registration and stabilize plan mode tests | `packages/ai/src/cli.ts`, `packages/ai/src/utils/schema/strict-mode.ts`, `packages/ai/src/utils/tool-call-healing.ts`, `packages/ai/test/kimi-tool-call-healing.test.ts`, `packages/ai/test/schema-compatibility.test.ts`, … (49 more) | code |
| `134732f3de` | fix(sync-upstream): fallback gracefully when git fetch upstream is offline | `.omp/skills/sync-upstream/sync.ts` | code |
| `17309751c4` | docs(sync-upstream): add packages/catalog/ to feature registry and regenerate SKILL.md | `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/feature-registry.yaml` | docs only |
| `59d521a220` | feat(extensions): restore skill grouping tree hierarchy, axis cycling, and group toggles | `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/feature-registry.yaml`, `packages/coding-agent/src/capability/skill.ts`, `packages/coding-agent/src/discovery/helpers.ts`, `packages/coding-agent/src/modes/components/extensions/extension-dashboard.ts`, … (5 more) | code |
| `de78c8e858` | feat(tui): add settings provenance layer badges and scope toggles | `packages/coding-agent/src/config/settings.ts`, `packages/coding-agent/src/modes/components/settings-selector.ts`, `packages/coding-agent/src/modes/theme/theme.ts`, `packages/coding-agent/test/settings-provenance.test.ts`, `packages/tui/src/components/settings-list.ts` | code |
| `48eb5263f9` | chore: update feature checklist, rules documentation, and minor cleanups | `.omp/extensions/feature-checklist.ts`, `.omp/rules/owp-feature-registry.md`, `packages/coding-agent/src/config/model-discovery.ts`, `packages/coding-agent/src/config/models-config-schema-bundle.ts`, `packages/coding-agent/src/discovery/omp-extension-roots.ts`, … (7 more) | chore |
| `6ec9561c4c` | docs(owp): update Fork Features table with recent commits (663ac71bb, 0b6c09240, 1baec5297) | `docs/maintaining-owp-fork.md` | docs only |
| `5f2de652ea` | docs(sync): update sync-upstream no-op handling and bump Last Sync Point to 5039b33a1 | `.omp/commands/sync-upstream.md`, `.omp/skills/sync-upstream/sync.ts`, `docs/maintaining-owp-fork.md` | mixed |
| `d7c1683799` | feat(web/search): separate google standard search and google-ai provider | `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/feature-registry.yaml`, `packages/coding-agent/src/web/search/provider.ts`, `packages/coding-agent/src/web/search/providers/google-ai.ts`, `packages/coding-agent/src/web/search/providers/google.ts`, … (1 more) | code |
| `21aa6d753b` | fix(modes): restore status line indicators and feedback for ask and debug modes | `packages/coding-agent/src/config/keybindings.ts`, `packages/coding-agent/src/config/settings-schema.ts`, `packages/coding-agent/src/modes/components/status-line/component.ts`, `packages/coding-agent/src/modes/components/status-line/segments.ts`, `packages/coding-agent/src/modes/components/status-line/types.ts`, … (7 more) | code |
| `02816d6f31` | fix(build): hard-error on stale native addon, pass host PATH through Bazel sandbox | `.bazelrc`, `MODULE.bazel`, `mise.toml`, `packages/natives/scripts/embed-native.ts` | code |
| `a3da523a89` | docs: update Fork Features table and feature registry for build config files | `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/feature-registry.yaml`, `docs/maintaining-owp-fork.md` | docs only |
| `8dea09855e` | fix(plan-mode): compute finalPlanFilePath in propose path for plan.storage project | `docs/maintaining-owp-fork.md`, `packages/coding-agent/src/modes/controllers/event-controller.ts`, `packages/coding-agent/src/plan-mode/approved-plan.ts`, `packages/coding-agent/src/session/agent-session.ts` | code |
| `0459195de3` | fix(plan-mode): compute finalPlanFilePath in propose path, update install-binary docs | `docs/maintaining-owp-fork.md`, `packages/coding-agent/src/extensibility/custom-commands/bundled/install-binary/index.ts`, `packages/coding-agent/src/modes/interactive-mode.ts`, `packages/coding-agent/src/plan-mode/storage.ts` | code |
| `894196cd4a` | fix(plan-report): idempotency guard + always write to project .omp/plans/ | `.omp/extensions/plan-report/plan-report.ts` | code |
| `dd11aa1b70` | fix(web/search): repair google-ai provider extraction and surface explicit provider failures | `packages/coding-agent/src/web/search/index.ts`, `packages/coding-agent/src/web/search/providers/google-ai.ts` | code |
| `ddec35e6c9` | fix: resolve all pre-existing TypeScript errors and stage pending fork changes | `.gitignore`, `.omp/plans/agent-provider-onboard-plan.done.md`, `.omp/plans/agent-provider-onboard-plan.report.md`, `.omp/plans/update-fork-features-table.md`, `.omp/skills/onboard-provider/SKILL.md`, … (19 more) | code |
| `be3f3a31bf` | docs(owp): update Fork Features table with recent commits (17ba5e74f, 5e86ce304, ef346c15c, 941a5f901) | `docs/maintaining-owp-fork.md` | docs only |
| `9326df616a` | fix(session): filter non-displayable messages from queuedMessageCount | `packages/coding-agent/src/session/agent-session.ts` | code |
| `9eaa3d92b2` | docs(sync): add onboard-provider to feature registry, regenerate SKILL.md | `.omp/skills/onboard-provider/SKILL.md`, `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/feature-registry.yaml` | docs only |
| `606f850d68` | docs(sync): update Last Sync Point to 896bf5f33e (17.2.12) | `MODULE.bazel.lock`, `docs/maintaining-owp-fork.md`, `packages/agent/src/append-only-context.ts`, `packages/ai/src/auth-broker/client.ts`, `packages/ai/src/auth-broker/discover.ts`, … (134 more) | mixed |
| `373a537714` | fix: restore missing stubs and fix lru-cache imports after rebase | `.omp/skills/onboard-provider/probe-provider.ts`, `packages/ai/src/auth-broker/index.ts`, `packages/ai/src/index.ts`, `packages/coding-agent/src/edit/file-read-cache.ts`, `packages/coding-agent/src/edit/hashline/diff.ts`, … (11 more) | code |
| `068b67f279` | docs(owp): update Fork Features table with post-sync fixes | `docs/maintaining-owp-fork.md` | docs only |
| `3263694fa6` | feat(owp): add reorganize-history tooling with deletion audit | `.omp/commands/reorganize-fork.md`, `.omp/skills/reorganize-history/SKILL.md`, `.omp/skills/reorganize-history/organize.ts`, `.omp/skills/sync-upstream/feature-registry.yaml` | code |
| `130ae474db` | fix(owp): take upstream auth-broker barrel instead of stub | `packages/ai/src/auth-broker/index.ts` | code |
| `7b76a5d056` | feat(owp): implement vault:// Obsidian vault protocol | `packages/coding-agent/src/internal-urls/vault-protocol.ts` | code |
| `1319ce32ad` | feat(session): yield queue entry receipts and aside settlement | `packages/coding-agent/src/session/yield-queue.ts` | code |
| `52da2bbbf0` | refactor(coding-agent): migrate tool schemas to @oh-my-pi/omptype | `packages/coding-agent/scripts/legacy-pi-virtual-module.ts`, `packages/coding-agent/src/config/models-config-writer.ts`, `packages/coding-agent/src/edit/modes/mimo.ts`, `packages/coding-agent/src/extensibility/custom-commands/loader.ts`, `packages/coding-agent/src/extensibility/extensions/loader.ts`, … (8 more) | code |
| `308b2d131d` | feat(sync): deletion audit against registry removals | `.omp/extensions/feature-checklist.ts`, `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/SKILL.md.template`, `.omp/skills/sync-upstream/generate-skill-md.ts`, `.omp/skills/sync-upstream/sync.ts`, … (1 more) | code |
| `e3ed5f5277` | feat(search): CAPTCHA wait/error behavior for web search | `packages/coding-agent/src/config/settings-schema.ts`, `packages/coding-agent/src/web/search/index.ts`, `packages/coding-agent/src/web/search/providers/base.ts`, `packages/coding-agent/src/web/search/providers/google-ai.ts`, `packages/coding-agent/src/web/search/types.ts` | code |
| `537072a67b` | chore(coding-agent): drop dangling auth-broker/gateway/worktree command entries | `packages/ai/package.json`, `packages/coding-agent/src/cli-commands.ts`, `packages/coding-agent/src/cli/command-help.ts` | chore |
| `049531cfe7` | fix(owp): name plan drafts after the plan title | `.omp/plans/done/agent-provider-onboard-plan.done.md`, `.omp/plans/reports/agent-provider-onboard-plan.report.md`, `packages/coding-agent/src/modes/interactive-mode.ts` | code |
| `93c8ef7231` | chore(robomp): rebuild static bundle | `python/robomp/src/static/assets/index-D-1YFgui.js`, `python/robomp/src/static/assets/index-DSeuZEu9.js`, `python/robomp/src/static/index.html` | chore |
| `a0cc1e7b63` | docs(owp): refresh generated Fork Features table | `docs/maintaining-owp-fork.md` | docs only |

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
