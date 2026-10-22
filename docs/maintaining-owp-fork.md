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

**Upstream base:** `0b5c27ab24` (`upstream/main`, 2026-10-22)
**Date:** 2026-10-22 (rebase onto upstream/main)
**omp commits since:** 0 - the fork sits on upstream's tip
To generate patches for your next sync:
```bash
git format-patch 0b5c27ab24719c86a5986b95ee55f4e75bc1aaa0..upstream/main
```

Update this section after each successful rebase.

---

## Fork Features (Curated Stack)

> fork/main is a linear stack of fork commits on top of `upstream/main`. The table below is **generated** from git history by `forklift render` — do not edit it by hand; run the command instead.

<!-- GENERATED:fork-commits:start -->
Total: 94 fork commits on top of `upstream/main..main`.

| Commit | Feature | Owned Files | Status |
|--------|---------|------------|--------|
| `21466d7089` | owp: Settings layering (project/global scope + revert) | `packages/coding-agent/src/config/settings-ui.ts`, `packages/coding-agent/src/config/settings.ts`, `packages/tui/src/overlays/settings-defs.ts`, `packages/tui/src/overlays/settings-selector.ts` | code |
| `8e61e911da` | owp: Identity | `README.md` | docs only |
| `085fa67300` | owp: Ask mode | `packages/coding-agent/src/modes/ask-mode/ask-mode-guard.ts`, `packages/coding-agent/src/modes/ask-mode/bash-readonly.ts`, `packages/coding-agent/src/modes/ask-mode/readonly-tools.ts`, `packages/coding-agent/src/modes/ask-mode/state.ts`, `packages/coding-agent/src/modes/ask-mode/tool-guard.ts`, … (3 more) | code |
| `d100733157` | owp: switch_mode tool | `packages/coding-agent/src/prompts/tools/switch-mode.md`, `packages/coding-agent/src/tools/index.ts`, `packages/coding-agent/src/tools/switch-mode.ts` | code |
| `a462324f7e` | owp: Debug mode | `packages/coding-agent/src/modes/debug-mode/log-server.ts`, `packages/coding-agent/src/modes/debug-mode/state.ts`, `packages/coding-agent/src/prompts/system/debug-mode-context.md` | code |
| `bf982297a2` | owp: Local discovery + two-level scan | `packages/coding-agent/src/discovery/helpers.ts`, `packages/coding-agent/src/discovery/index.ts`, `packages/coding-agent/src/discovery/pi.ts` | code |
| `3325d843d0` | owp: Skill grouping | `packages/coding-agent/src/capability/skill.ts`, `packages/coding-agent/src/modes/components/extensions/state-manager.ts`, `packages/tui/src/overlays/extensions/extension-dashboard.ts`, `packages/tui/src/overlays/extensions/extension-list.ts` | code |
| `e020e87390` | owp: baseUrl resolution | `packages/coding-agent/src/config/model-registry.ts` | code |
| `413fad52aa` | owp: Google search provider | `packages/coding-agent/src/config/settings-schema.ts`, `packages/coding-agent/src/web/search/providers/google-ai.ts`, `packages/coding-agent/src/web/search/providers/google.ts` | code |
| `8349863dc3` | owp: SerpAPI search provider | `packages/ai/src/stream.ts`, `packages/coding-agent/src/web/search/provider.ts`, `packages/coding-agent/src/web/search/providers/serpapi.ts`, `packages/coding-agent/src/web/search/types.ts` | code |
| `2206989199` | owp: Plan mode /plan load | `packages/coding-agent/src/plan-mode/state.ts` | code |
| `5dd6a4b86f` | owp: Plan storage project path fix | `packages/coding-agent/src/modes/controllers/event-controller.ts`, `packages/coding-agent/src/modes/interactive-mode.ts`, `packages/coding-agent/src/plan-mode/approved-plan.ts`, `packages/coding-agent/src/plan-mode/resolve-handler.ts`, `packages/coding-agent/src/plan-mode/storage.ts` | code |
| `bcae84b20a` | owp: Provider onboarding wizard | `packages/coding-agent/src/modes/components/provider-onboarding-wizard.ts` | code |
| `d5b7de5f01` | owp: Install-binary custom command | `packages/coding-agent/src/extensibility/custom-commands/bundled/install-binary/index.ts` | code |
| `ba539d25ec` | owp: @mariozechner/* loader aliases | `packages/coding-agent/src/extensibility/custom-commands/loader.ts`, `packages/coding-agent/src/extensibility/extensions/loader.ts` | code |
| `a238f2b7a0` | owp: Test filter scope fix | `packages/coding-agent/test/utils/filter-user-extensions.ts` | code |
| `b12a54d4fc` | owp: Unified agent mode cycle (alt+k) | `packages/coding-agent/src/modes/controllers/input-controller.ts`, `packages/tui/src/app-keybindings.ts`, `packages/tui/src/status-line/component.ts`, `packages/tui/src/status-line/segments.ts`, `packages/tui/src/status-line/types.ts` | code |
| `3e8a1bb070` | owp: Session directory event + jiti loader + authHeader fix | `packages/coding-agent/src/sdk.ts`, `packages/coding-agent/src/session/auth-broker-config.ts`, `packages/coding-agent/src/session/prewalk.ts` | code |
| `9e75569912` | owp: Cache write token tracking + bin/owp switcher | `bin/owp`, `docs/cache-token-tracking.md` | code |
| `a307690a41` | owp: Build dist/owp as primary output | `packages/coding-agent/scripts/build-binary.ts` | code |
| `4b0eef3035` | owp: Compiled-binary boot fixes (bytecode ESM + addon archive extraction) | `packages/coding-agent/scripts/compile-binary.ts`, `scripts/ci-release-build-binaries.test.ts` | code |
| `c35a937541` | owp: Fix plan-mode approval UI + omp bin entry + ETXTBSY fix | `packages/coding-agent/package.json`, `packages/coding-agent/test/tools/bash-interceptor.test.ts` | code |
| `32c673aec6` | owp: Google search provider + hashline recovery + mode fixes | `.omp/extensions/pi-peon/config.ts`, `.omp/extensions/pi-peon/index.ts`, `.omp/extensions/pi-peon/install.ts`, `.omp/extensions/pi-peon/pack.ts`, `.omp/extensions/pi-peon/package.json`, … (11 more) | code |
| `65efe302e2` | owp: sync-upstream skill and script | `.forklift/registry.yaml`, `.omp/commands/sync-upstream.md`, `.omp/rules/owp-feature-registry.md` | docs only |
| `e0cdacd1ff` | owp: feature-checklist extension | `.omp/extensions/feature-checklist.ts` | code |
| `ddc24a462d` | owp: mise.toml + native rebuild docs | `mise.toml` | code |
| `512438dd40` | owp: Bazel build config (hermetic PATH, crate annotations) | `.bazelrc`, `MODULE.bazel` | code |
| `d3c3b2e15c` | owp: Add .gitnexus, .claude/, CLAUDE.md to .gitignore | `.gitignore` | code |
| `d2238e5b60` | owp: MiMo-Code edit mode | `packages/coding-agent/src/edit/index.ts`, `packages/coding-agent/src/edit/modes/mimo.ts`, `packages/coding-agent/src/utils/edit-mode.ts`, `packages/tui/src/tools/edit.ts` | code |
| `8e86eb206c` | owp: Archive skill-group-toggle openspec spec | `openspec/specs/skill-group-toggle/spec.md` | docs only |
| `52b20dde44` | owp: Work around zlob/zig build failure on macOS 26 | `crates/pi-natives/src/summary.rs` | code |
| `b3dd40921e` | owp: OWP workspace and plans | `.omp/extensions/ask-mode-guard.ts`, `.omp/extensions/opencode-zen-free-tier.ts`, `.omp/extensions/plan-author/index.ts`, `.omp/extensions/plan-author/lookup.ts`, `.omp/extensions/plan-author/package.json`, … (20 more) | code |
| `2c15218416` | owp: OWP skills | `.omp/skills/google-ai-research/SKILL.md`, `.omp/skills/onboard-provider/SKILL.md`, `.omp/skills/onboard-provider/probe-provider.ts`, `.omp/skills/skill-installer/SKILL.md`, `.omp/skills/tmux-debug/SKILL.md` | code |
| `8dd9f340d0` | owp: OWP spec docs | `openspec/config.yaml`, `openspec/specs/ask-mode/spec.md`, `openspec/specs/debug-mode/spec.md`, `openspec/specs/dual-mode-extension-loader/spec.md`, `openspec/specs/install-binary-command/spec.md`, … (4 more) | docs only |
| `8a91dc17e1` | owp: OWP AI package | `packages/ai/src/cli.ts`, `packages/ai/src/index.ts`, `packages/ai/src/utils/h2-fetch.ts`, `packages/ai/src/utils/schema/normalize-cca.ts`, `packages/ai/src/utils/schema/sanitize-google.ts`, … (4 more) | code |
| `4006fd167d` | owp: OWP agent package | `packages/agent/src/append-only-context.ts`, `packages/agent/test/otel.test.ts` | code |
| `423dc37ac8` | owp: OWP coding-agent package | `packages/coding-agent/scripts/legacy-pi-virtual-module.ts`, `packages/coding-agent/src/cli/gallery-fixtures/segments.ts`, `packages/coding-agent/src/commands/install.ts`, `packages/coding-agent/src/config/file-lock.ts`, `packages/coding-agent/src/config/model-discovery.ts`, … (56 more) | code |
| `8cfbb7a61c` | owp: OWP natives package | `packages/natives/native/embedded-addon.js`, `packages/natives/native/index.d.ts`, `packages/natives/test/windows-staging.test.ts` | code |
| `dfc305026f` | owp: OWP TUI package | `packages/tui/src/autocomplete.ts`, `packages/tui/src/components/settings-list.ts`, `packages/tui/src/overlays/extensions/inspector-panel.ts`, `packages/tui/src/overlays/extensions/types.ts`, `packages/tui/src/symbols.ts`, … (8 more) | code |
| `346b94c54b` | owp: OWP catalog package | `packages/catalog/src/compat/rules/classes/anthropic.kdl`, `packages/catalog/test/build.test.ts`, `packages/catalog/test/generated-policies.test.ts`, `packages/catalog/test/synthetic-provider.test.ts`, `packages/catalog/test/yolo-auto-provider.test.ts` | code |
| `65915e03d5` | owp: OWP scripts | `scripts/eval-bench-runs.ts`, `scripts/session-stats/README.md` | code |
| `9fe25c7cd0` | owp: OWP documentation | `docs/ask_session.md`, `docs/bugs/ask-mode-switch-tool-missing.md`, `docs/bugs/bytecode-childprocess-binding.md`, `docs/bugs/debug-mode-lifecycle.md`, `docs/bugs/edit-tool-session-gaps.md`, … (7 more) | docs only |
| `a9ad52e812` | owp: OWP root config and assets | `Dockerfile` | code |
| `9af7a42d22` | owp: Command dispatch composition | `packages/coding-agent/src/slash-commands/builtin-modes.ts` | code |
| `26cbcc16d5` | owp: Forklift harness | `.forklift/README.md`, `.forklift/footprint-baseline.json`, `.forklift/harness.lock`, `.omp/skills/forklift-doctor/SKILL.md`, `.omp/skills/forklift-init/SKILL.md`, … (3 more) | code |
| `543289bf94` | owp: OWP fork test suite | `packages/coding-agent/test/agent-session-message-pipeline.test.ts`, `packages/coding-agent/test/agent-session-plan-mode-convergence.test.ts`, `packages/coding-agent/test/config/schema-introspector.test.ts`, `packages/coding-agent/test/discovery/agent-fields.test.ts`, `packages/coding-agent/test/discovery/agents-monorepo-skills.test.ts`, … (39 more) | code |
| `750c958825` | owp: OWP robomp web bundle | `python/robomp/src/static/assets/index-BCntletT.js`, `python/robomp/src/static/assets/style-B9LxyhOi.css`, `python/robomp/src/static/index.html` | code |
| `a5f2525260` | owp: remove python/robomp/ — The fork carries only a trimmed subset of upstream robomp (59 tracked files); the remaining upstream paths are absent on purpose and would otherwise be restored by the next sync. The subset that IS kept is fork-modified and is registered under features (OWP Python RPC), not here. | `python/robomp/.env.example`, `python/robomp/.gitignore`, `python/robomp/AGENTS.md`, `python/robomp/README.md`, `python/robomp/assets/icon.jpg`, … (73 more) | code |
| `e8eb05929c` | owp: remove packages/coding-agent/test/auth-broker-migrate.test.ts — fork stubs resolveAuthBrokerConfig to null (no auth-broker) — broker-migration tests cannot pass by design | `packages/coding-agent/test/auth-broker-migrate.test.ts` | code |
| `4e83ce1b9f` | owp: remove packages/coding-agent/test/auth-broker-snapshot-cache.test.ts — fork stubs resolveAuthBrokerConfig to null — broker snapshot-cache tests cannot pass by design | `packages/coding-agent/test/auth-broker-snapshot-cache.test.ts` | code |
| `b1f821a813` | owp: remove packages/coding-agent/test/auth-gateway-account-pool.test.ts — fork does not ship the auth gateway broker | `packages/coding-agent/test/auth-gateway-account-pool.test.ts` | code |
| `10d7191280` | owp: remove packages/coding-agent/test/issue-8096-broker-unreachable-startup.test.ts — broker-unreachable startup paths are unreachable with the fork's null broker config; describeAuthBrokerStartupError is retained defensively | `packages/coding-agent/test/issue-8096-broker-unreachable-startup.test.ts` | code |
| `ec38f61298` | owp: remove packages/coding-agent/test/ — chore(owp): remove upstream-only components | `packages/coding-agent/test/auth-broker-import.test.ts`, `packages/coding-agent/test/compaction-prefer-current-model.test.ts`, `packages/coding-agent/test/discovery/builtin-rules-md.test.ts`, `packages/coding-agent/test/eval/console-table.test.ts`, `packages/coding-agent/test/extensibility/custom-commands/review.test.ts`, … (35 more) | code |
| `384d881624` | owp: remove packages/utils/test/ — chore(owp): remove upstream-only components | `packages/utils/test/env.test.ts`, `packages/utils/test/format.test.ts`, `packages/utils/test/install-id.test.ts`, `packages/utils/test/sanitize-text.test.ts` | code |
| `8de401419a` | owp: remove Dockerfile.robomp* — chore(owp): remove upstream-only components | `Dockerfile.robomp`, `Dockerfile.robomp.dockerignore` | code |
| `cf4b70ea17` | owp: remove Dockerfile.dockerignore — chore(owp): remove upstream-only components | `Dockerfile.dockerignore` | code |
| `254f0f2f02` | owp: remove packages/agent/test/compaction-error-status.test.ts — chore(owp): remove upstream-only components | `packages/agent/test/compaction-error-status.test.ts` | code |
| `3b57e07324` | owp: remove packages/agent/test/compaction-telemetry.test.ts — chore(owp): remove upstream-only components | `packages/agent/test/compaction-telemetry.test.ts` | code |
| `39878878a1` | owp: remove packages/agent/test/compaction-thinking-level.test.ts — chore(owp): remove upstream-only components | `packages/agent/test/compaction-thinking-level.test.ts` | code |
| `d6216c896b` | owp: remove packages/agent/test/yield.test.ts — chore(owp): remove upstream-only components | `packages/agent/test/yield.test.ts` | code |
| `b8224bdf03` | owp: remove packages/coding-agent/examples/sdk/12-redis-sessions.ts — chore(owp): remove upstream-only components | `packages/coding-agent/examples/sdk/12-redis-sessions.ts` | code |
| `343126e9c7` | owp: remove packages/coding-agent/examples/sdk/13-sql-sessions.ts — chore(owp): remove upstream-only components | `packages/coding-agent/examples/sdk/13-sql-sessions.ts` | code |
| `ddb222ee9d` | owp: remove packages/catalog/test/google-vertex-discovery.test.ts — chore(owp): remove upstream-only components | `packages/catalog/test/google-vertex-discovery.test.ts` | code |
| `4690d536ba` | owp: remove packages/catalog/test/wafer.test.ts — chore(owp): remove upstream-only components | `packages/catalog/test/wafer.test.ts` | code |
| `d3ed5fca30` | owp: remove packages/tui/test/emoji-autocomplete.test.ts — chore(owp): remove upstream-only components | `packages/tui/test/emoji-autocomplete.test.ts` | code |
| `96d3d41af6` | owp: remove packages/tui/test/hyperlink.test.ts — chore(owp): remove upstream-only components | `packages/tui/test/hyperlink.test.ts` | code |
| `1d1a4773ba` | owp: remove packages/tui/test/raw-sse-pretty.test.ts — chore(owp): remove upstream-only components | `packages/tui/test/raw-sse-pretty.test.ts` | code |
| `3653376fc7` | owp: remove packages/tui/test/settings-list-theme.test.ts — chore(owp): remove upstream-only components | `packages/tui/test/settings-list-theme.test.ts` | code |
| `af30a81f70` | owp: remove packages/tui/test/shimmer.test.ts — chore(owp): remove upstream-only components | `packages/tui/test/shimmer.test.ts` | code |
| `e78248fa90` | owp: remove packages/tui/test/status-line-cache-hit.test.ts — chore(owp): remove upstream-only components | `packages/tui/test/status-line-cache-hit.test.ts` | code |
| `a45e456671` | owp: remove packages/tui/test/task-nested-live-render.test.ts — chore(owp): remove upstream-only components | `packages/tui/test/task-nested-live-render.test.ts` | code |
| `ad999fb196` | fix(coding-agent): repair the runtime seams after the upstream rebuild | `.forklift/registry.yaml`, `mise.toml`, `packages/ai/src/cli.ts`, `packages/ai/src/env-api-key.ts`, `packages/coding-agent/src/cli/web-search-cli.ts`, … (43 more) | code |
| `e3340db91b` | chore(owp): rebaseline the fork commit count to 73 | `.forklift/registry.yaml`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `1206f24f55` | chore(owp): register the rebuilt fork's own files and rebase the count | `.forklift/registry.yaml`, `.omp/skills/sync-upstream/SKILL.md`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `b22e0aece1` | chore(owp): re-baseline the fork footprint after the rebuild | `.forklift/footprint-baseline.json` | chore |
| `806db7186c` | chore(owp): rebaseline the fork commit count to 76 | `.forklift/registry.yaml`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `d6de956fed` | chore(owp): drop the stale SEARCH_PROVIDER_OPTIONS owned symbol | `.forklift/registry.yaml`, `.omp/skills/sync-upstream/SKILL.md`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `0f3377635b` | chore(owp): refresh the owned-symbol registry after the rebuild | `.forklift/registry.yaml`, `.omp/skills/sync-upstream/SKILL.md`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `2bd2ba9d7a` | chore(owp): prune the stats owned symbols and record the new sync point | `.forklift/registry.yaml`, `.omp/skills/sync-upstream/SKILL.md`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `c542f279e4` | feat(search): make the fork's serpapi and google-ai engines reachable again | `packages/catalog/src/compat/rules.json`, `packages/catalog/src/compat/rules/providers/web.kdl`, `packages/catalog/src/models.json`, `packages/coding-agent/src/web/search/provider.ts` | code |
| `a8711354fa` | test(vibe): port the two hanging vibe-runtime tests to the current loader | `packages/coding-agent/test/vibe/vibe-runtime.test.ts` | code |
| `4cfbb8b85f` | chore(owp): sharpen the robomp removals rule and document the toolchain pins | `.forklift/registry.yaml`, `docs/maintaining-owp-fork.md` | chore |
| `6e5d5d6210` | chore(owp): rebaseline the fork commit count to 83 | `.forklift/registry.yaml`, `.omp/skills/sync-upstream/SKILL.md`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `c8594482d4` | chore(owp): register the catalog files the fork now owns | `.forklift/registry.yaml`, `.omp/skills/sync-upstream/SKILL.md`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `f474dbf75e` | chore(owp): re-baseline the task executor footprint entry | `.forklift/footprint-baseline.json`, `.forklift/registry.yaml`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `5b2c13d39a` | chore(owp): rebaseline the fork commit count to 86 | `.forklift/registry.yaml`, `.omp/skills/forklift-maintain/SKILL.md`, `.omp/skills/sync-upstream/SKILL.md`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `53bc15b969` | chore(owp): rebaseline the fork commit count to 87 | `.forklift/registry.yaml`, `.omp/commands/forklift-audit.md`, `.omp/commands/forklift-bootstrap.md`, `.omp/commands/forklift-feature.md`, `.omp/commands/forklift-rebuild.md`, … (4 more) | chore |
| `6b6fd354c5` | chore(owp): rebaseline the fork commit count to 88 | `.forklift/registry.yaml`, `.omp/commands/forklift-audit.md`, `.omp/commands/forklift-bootstrap.md`, `.omp/commands/forklift-feature.md`, `.omp/commands/forklift-rebuild.md`, … (6 more) | chore |
| `8110a0be8f` | feat(search): keep the fork's web engines reachable through the catalog | `packages/coding-agent/src/web/search/types.ts`, `packages/coding-agent/test/web/search/fork-engines.test.ts` | code |
| `6a5e50090f` | chore(owp): rebaseline the fork commit count to 90 | `.forklift/registry.yaml`, `.omp/skills/sync-upstream/SKILL.md`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `895381a24c` | chore(owp): rebaseline the fork commit count to 91 | `.forklift/registry.yaml`, `AGENT.md`, `docs/maintaining-owp-fork.md` | chore |
| `4fd6259081` | owp: derive the session mode, and let switch_mode report the outcome | `docs/mode-registry-future-architecture.md`, `packages/coding-agent/src/modes/controllers/event-controller.ts`, `packages/coding-agent/src/modes/interactive-mode.ts`, `packages/coding-agent/src/modes/mode-state.ts`, `packages/coding-agent/src/prompts/tools/switch-mode.md`, … (10 more) | code |
| `9a23818570` | chore(owp): register the derived-mode module and the fork's new test | `.forklift/registry.yaml` | chore |
| `pending` | chore(owp): render the fork table and move the expected count to 94 | — | chore |

> **Note:** Generated from `git log upstream/main..main`. A row whose commit is still `pending` is the newest commit in the range — its hash and its file list are unknown until that commit lands, `forklift render` resolves it on the next render. Commit hashes change on every rebase — refresh this table by running `forklift render`, never by hand.
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

## Toolchain

The fork builds and runs against the toolchain upstream pins. After every sync, check `mise.toml`
and upstream's `rust-toolchain.toml` / `package.json#packageManager` — a moved pin breaks the build
in ways that look like fork bugs.

| Tool | Pin (in `mise.toml`) | Why it matters |
|------|----------------------|----------------|
| bun | `1.4.3` | upstream requires `bun@>=1.4`. Bun 1.3.x **silently drops setuid/setgid/sticky bits** in `fs.chmod`, so file-mode assertions (e.g. the hashline move-permissions test) fail on a stale bun. |
| rust | `nightly-2026-10-06` | upstream's `rust-toolchain.toml` pins the same nightly. `crates/pi-vfs` uses `result_option_map_or_default`, which older nightlies reject (`E0658`), so the native addon does not compile. |
| zig | `0.14.0` | native addon build dependency. |
| difftastic | `github:Wilfred/difftastic` | the structural reader for the Conflict Walk (`harness.checks.semantic_drift`). Optional: without it the walk renders git-only. |

After a version bump:

```bash
mise install                                   # pick up the new pins
mise exec -- bun --cwd=packages/natives run build   # rebuild the native addon
```

The native addon embeds a version stamp (`PI_NATIVES_VERSION_STAMP:<version>`); the loader refuses a
stale binary, so a version bump without a rebuild is a startup crash for every user.

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
