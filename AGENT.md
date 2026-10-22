# Agent Instructions — oh-wiblo-pi

This repository is a **fork** of oh-my-pi kept in sync by forklift. Everything between the two markers below is generated from `.forklift/registry.yaml`: edit the registry and re-run `forklift render` rather than editing the block. Prose outside the markers is hand-maintained and preserved byte-for-byte.

<!-- GENERATED:FORKLIFT_START -->
<!-- Do not edit this block: `forklift render` regenerates it. The tables come from .forklift/registry.yaml; the situation playbook comes from templates/situations.yaml. -->
## Fork Identity & Remotes
- **Fork remote/branch**: `origin/main`
- **Upstream remote/branch**: `upstream/main`
- **Expected fork commits**: `96`

## Fork-Owned Features
These are the paths this fork owns; prefer ours when they conflict with upstream, and register any new fork-owned path in `.forklift/registry.yaml` before relying on it.

| Feature | Description | Owned Paths |
| --- | --- | --- |
| Settings layering (project/global scope + revert) | Per-setting provenance (getLayer), scoped set({scope: project\|global}) persisting to <project>/.omp/config.yml, clearGlobal/clearProject revert; settings UI layer badges + Ctrl+S scope toggle + Delete revert | `packages/coding-agent/src/config/settings-ui.ts`<br>`packages/coding-agent/src/config/settings.ts`<br>`packages/tui/src/overlays/settings-defs.ts`<br>`packages/tui/src/overlays/settings-selector.ts` |
| Identity | README fork marker | `README.md` |
| Ask mode | — | `packages/coding-agent/src/modes/ask-mode/`<br>`packages/coding-agent/src/prompts/system/ask-mode-context.md`<br>`packages/coding-agent/src/session/agent-session.ts`<br>`packages/coding-agent/src/slash-commands/builtin-registry.ts` |
| switch_mode tool | Agent-initiated mode switch; always active at top level, never xd://-mounted | `packages/coding-agent/src/modes/mode-state.ts`<br>`packages/coding-agent/src/prompts/tools/switch-mode.md`<br>`packages/coding-agent/src/tools/index.ts`<br>`packages/coding-agent/src/tools/switch-mode.ts` |
| Debug mode | Mode directive is appended by AgentSession.getModeContextPrompt(); the log server is started in enableDebugMode and stopped on disable/dispose | `packages/coding-agent/src/modes/debug-mode/`<br>`packages/coding-agent/src/prompts/system/debug-mode-context.md`<br>`packages/coding-agent/src/session/agent-session.ts`<br>`packages/coding-agent/src/slash-commands/builtin-registry.ts` |
| Local discovery + two-level scan | Providers self-register on import; discovery/index.ts is the only trigger and MUST keep importing ./pi | `packages/coding-agent/src/discovery/helpers.ts`<br>`packages/coding-agent/src/discovery/index.ts`<br>`packages/coding-agent/src/discovery/pi.ts` |
| Skill grouping | — | `packages/coding-agent/src/capability/skill.ts`<br>`packages/coding-agent/src/modes/components/extensions/state-manager.ts`<br>`packages/tui/src/overlays/extensions/extension-dashboard.ts`<br>`packages/tui/src/overlays/extensions/extension-list.ts` |
| baseUrl resolution | — | `packages/coding-agent/src/config/model-registry.ts` |
| openai-compatible discovery | — | `packages/coding-agent/src/config/model-registry.ts` |
| disableStrictTools escape hatch | — | `packages/ai/src/providers/anthropic.ts`<br>`packages/ai/src/types.ts`<br>`packages/coding-agent/src/config/model-registry.ts` |
| Google search provider | — | `packages/coding-agent/src/config/settings-schema.ts`<br>`packages/coding-agent/src/web/search/providers/google-ai.ts`<br>`packages/coding-agent/src/web/search/providers/google.ts` |
| SerpAPI search provider | Scraper-backed provider; its credential key (LEGACY_ENV_KEYS) lives in the AI package, so a conflict there silently kills availability | `packages/ai/src/stream.ts`<br>`packages/coding-agent/src/web/search/provider.ts`<br>`packages/coding-agent/src/web/search/providers/serpapi.ts`<br>`packages/coding-agent/src/web/search/types.ts` |
| Fork web engines reachable through the catalog role chain | The fork's serpapi and google-ai engines are only selectable through the catalog - the web role chain resolves catalog models, so an engine without a catalog web/<id> row is loadable but unreachable. The rows live in the fork's copy of the catalog web provider rules. | `packages/catalog/src/compat/rules/providers/web.kdl` |
| Plan mode /plan load | — | `packages/coding-agent/src/modes/ask-mode/bash-readonly.ts`<br>`packages/coding-agent/src/modes/ask-mode/tool-guard.ts`<br>`packages/coding-agent/src/plan-mode/state.ts`<br>`packages/coding-agent/src/slash-commands/builtin-registry.ts` |
| Plan storage project path fix | Forward finalPlanFilePath in approve/save paths so plan.storage=project saves to .omp/plans/ | `packages/coding-agent/src/modes/controllers/event-controller.ts`<br>`packages/coding-agent/src/modes/interactive-mode.ts`<br>`packages/coding-agent/src/plan-mode/approved-plan.ts`<br>`packages/coding-agent/src/plan-mode/resolve-handler.ts`<br>`packages/coding-agent/src/plan-mode/storage.ts` |
| Provider onboarding wizard | — | `packages/coding-agent/src/modes/components/provider-onboarding-wizard.ts`<br>`packages/tui/src/overlays/settings-defs.ts` |
| Install-binary custom command | — | `packages/coding-agent/src/extensibility/custom-commands/bundled/install-binary/` |
| @mariozechner/* loader aliases | Alias graph + bunfs virtual modules relocated upstream into legacy-pi-compat.ts; the loaders only install it | `packages/coding-agent/src/extensibility/custom-commands/loader.ts`<br>`packages/coding-agent/src/extensibility/extensions/loader.ts`<br>`packages/coding-agent/src/extensibility/plugins/legacy-pi-compat.ts` |
| History reorganization tooling | lifted into 'forklift reorg' (npm @whiteblossom/forklift) — no paths owned in this repo |  |
| Test filter scope fix | — | `packages/coding-agent/test/utils/filter-user-extensions.ts` |
| Unified agent mode cycle (alt+k) | — | `packages/coding-agent/src/config/settings-schema.ts`<br>`packages/coding-agent/src/modes/controllers/input-controller.ts`<br>`packages/tui/src/app-keybindings.ts`<br>`packages/tui/src/status-line/component.ts`<br>`packages/tui/src/status-line/segments.ts`<br>`packages/tui/src/status-line/types.ts` |
| Session directory event + jiti loader + authHeader fix | — | `packages/coding-agent/src/extensibility/extensions/loader.ts`<br>`packages/coding-agent/src/sdk.ts`<br>`packages/coding-agent/src/session/auth-broker-config.ts`<br>`packages/coding-agent/src/session/prewalk.ts` |
| Cache write token tracking + bin/owp switcher | — | `bin/owp`<br>`docs/cache-token-tracking.md`<br>`packages/ai/src/providers/openai-completions.ts` |
| Use jiti with virtualModules in custom command loader | — | `packages/coding-agent/src/extensibility/custom-commands/loader.ts` |
| Fix isBunBinary in compiled binary | Predicate relocated upstream to isCompiledBinary() in pi-utils; config.ts never carried it at the pre-rebuild tip either | `packages/utils/src/env.ts` |
| Build dist/owp as primary output | — | `packages/coding-agent/scripts/build-binary.ts` |
| Compiled-binary boot fixes (bytecode ESM + addon archive extraction) | Fork-side ports of upstream fixes that landed without syncing: 020ed9fdc1 (compile with format:"esm" so import.meta.resolve in bundled deps survives bytecode lowering) and cc258b1757 (tar.gz embedded-addon extraction in loader-state.js). Both converge with upstream at next sync. | `packages/coding-agent/scripts/compile-binary.ts`<br>`packages/natives/native/loader-state.js`<br>`scripts/ci-release-build-binaries.test.ts` |
| Fix plan-mode approval UI + omp bin entry + ETXTBSY fix | — | `packages/coding-agent/package.json`<br>`packages/coding-agent/src/extensibility/custom-commands/bundled/install-binary/index.ts`<br>`packages/coding-agent/src/modes/controllers/event-controller.ts`<br>`packages/coding-agent/test/tools/bash-interceptor.test.ts` |
| Google search provider + hashline recovery + mode fixes | Hashline editing itself was nativized upstream (crates/pi-edit modes/hashline) — the fork's JS pipeline (packages/hashline + edit/hashline executors) was retired in favor of the native engine; the fork keeps the MiMo edit mode on top of it. | `.omp/extensions/pi-peon/`<br>`.omp/skills/owp-developer/`<br>`packages/coding-agent/src/modes/interactive-mode.ts`<br>`packages/coding-agent/src/web/search/index.ts`<br>`packages/coding-agent/src/web/search/providers/base.ts`<br>`packages/coding-agent/src/web/search/providers/google-selectors.json` |
| Upstream-deleted module stubs | Minimal stubs for upstream-deleted modules required by OWP features | `packages/coding-agent/src/tools/approval.ts`<br>`packages/coding-agent/src/tools/output-schema-validator.ts`<br>`packages/utils/src/sanitize-text.ts` |
| sync-upstream skill and script | legacy skill dir retired; the harness now lives in npm @whiteblossom/forklift and renders into this repo | `.forklift/registry.yaml`<br>`.omp/rules/owp-feature-registry.md` |
| feature-checklist extension | Loaded at runtime by the extension loader from the workspace .omp/extensions directory; never imported, so the import-liveness check cannot apply. The .generated.ts sibling is rewrite-owned by forklift render/install. | `.omp/extensions/feature-checklist.ts`<br>`.omp/extensions/owp-checklist.generated.ts` |
| Cast node Blob to Web Blob for tsgo | streams.ts was renamed upstream to stream.ts; the writethrough seam now takes BunFile so the cast is moot | `packages/utils/src/stream.ts` |
| mise.toml + native rebuild docs | — | `mise.toml` |
| Bazel build config (hermetic PATH, crate annotations) | — | `.bazelrc`<br>`MODULE.bazel`<br>`MODULE.bazel.lock` |
| Add .gitnexus, .claude/, CLAUDE.md to .gitignore | — | `.gitignore` |
| Deduplicate slash command autocomplete | — | `packages/coding-agent/src/modes/interactive-mode.ts` |
| Add serpapi, gemini, codex to settings-defs | — | `packages/tui/src/overlays/settings-defs.ts` |
| Add /refresh-models slash command | — | `packages/coding-agent/src/slash-commands/builtin-registry.ts` |
| MiMo-Code edit mode | Fork-only edit mode (exact-match replacer chain ported from MiMo-Code), running as a JS branch inside the upstream-native edit tool; mimo-model auto-selection in resolveEditMode | `packages/coding-agent/src/edit/index.ts`<br>`packages/coding-agent/src/edit/modes/mimo.ts`<br>`packages/coding-agent/src/utils/edit-mode.ts`<br>`packages/tui/src/tools/edit.ts` |
| Archive skill-group-toggle openspec spec | — | `openspec/specs/skill-group-toggle/spec.md` |
| Rediscover skills on /new after ECC toggles | newSession() re-runs discovery through the existing refresh seam, gated on skills.rediscoverOnNewSession | `packages/coding-agent/src/capability/skill.ts`<br>`packages/coding-agent/src/config/settings-schema.ts`<br>`packages/coding-agent/src/sdk.ts`<br>`packages/coding-agent/src/session/agent-session.ts` |
| Work around zlob/zig build failure on macOS 26 | — | `crates/pi-natives/src/summary.rs` |
| OWP workspace and plans | — | `.omp/extensions/`<br>`.omp/plans/`<br>`.omp/rules/`<br>`.omp/settings.json` |
| OWP Claude workspace | — | `.claude/` |
| OWP skills | — | `.omp/skills/google-ai-research/`<br>`.omp/skills/onboard-provider/`<br>`.omp/skills/owp-developer/`<br>`.omp/skills/skill-installer/`<br>`.omp/skills/tmux-debug/` |
| OWP commands | — | `.omp/commands/fix-issues.md`<br>`.omp/commands/release.md`<br>`.omp/commands/review-prs.md`<br>`.omp/commands/triage.md` |
| OWP spec docs | — | `openspec/config.yaml`<br>`openspec/specs/ask-mode/`<br>`openspec/specs/debug-mode/`<br>`openspec/specs/dual-mode-extension-loader/`<br>`openspec/specs/install-binary-command/`<br>`openspec/specs/mode-cycle-keybinding/`<br>`openspec/specs/rpc-ask-debug/`<br>`openspec/specs/session-directory-event/`<br>`openspec/specs/skill-rediscovery/` |
| OWP AI package | — | `packages/ai/src/cli.ts`<br>`packages/ai/src/env-api-key.ts`<br>`packages/ai/src/index.ts`<br>`packages/ai/src/utils/h2-fetch.ts`<br>`packages/ai/src/utils/schema/normalize-cca.ts`<br>`packages/ai/src/utils/schema/sanitize-google.ts`<br>`packages/ai/src/utils/schema/strict-mode.ts`<br>`packages/ai/src/utils/schema/zod-decontaminate.ts`<br>`packages/ai/src/utils/tool-call-healing.ts`<br>`packages/ai/test/kimi-tool-call-healing.test.ts` |
| OWP agent package | — | `packages/agent/src/append-only-context.ts`<br>`packages/agent/test/otel.test.ts` |
| OWP coding-agent package | — | `packages/coding-agent/CHANGELOG.md`<br>`packages/coding-agent/scripts/legacy-pi-virtual-module.ts`<br>`packages/coding-agent/src/cli/gallery-fixtures/segments.ts`<br>`packages/coding-agent/src/cli/web-search-cli.ts`<br>`packages/coding-agent/src/commands/install.ts`<br>`packages/coding-agent/src/config/all-settings.ts`<br>`packages/coding-agent/src/config/file-lock.ts`<br>`packages/coding-agent/src/config/model-discovery.ts`<br>`packages/coding-agent/src/config/models-config-schema-bundle.ts`<br>`packages/coding-agent/src/config/models-config-schema.ts`<br>`packages/coding-agent/src/config/models-config-writer.ts`<br>`packages/coding-agent/src/config/provider-probe.ts`<br>`packages/coding-agent/src/config/registry.ts`<br>`packages/coding-agent/src/config/schema-introspector.ts`<br>`packages/coding-agent/src/discovery/omp-plugins.ts`<br>`packages/coding-agent/src/edit/blackbox.ts`<br>`packages/coding-agent/src/edit/diff.ts`<br>`packages/coding-agent/src/edit/modes/replace.ts`<br>`packages/coding-agent/src/edit/normalize.ts`<br>`packages/coding-agent/src/edit/notebook.ts`<br>`packages/coding-agent/src/edit/read-file.ts`<br>`packages/coding-agent/src/edit/settings.ts`<br>`packages/coding-agent/src/eval/llm-bridge.ts`<br>`packages/coding-agent/src/extensibility/extensions/types.ts`<br>`packages/coding-agent/src/extensibility/settings.ts`<br>`packages/coding-agent/src/internal-urls/docs-index.generated.ts`<br>`packages/coding-agent/src/internal-urls/memory-protocol.ts`<br>`packages/coding-agent/src/irc/settings.ts`<br>`packages/coding-agent/src/launch/broker.ts`<br>`packages/coding-agent/src/main.ts`<br>`packages/coding-agent/src/markit/converters/mammoth.d.ts`<br>`packages/coding-agent/src/mcp/discoverable-tool-metadata.ts`<br>`packages/coding-agent/src/modes/ask-mode/ask-mode-guard.ts`<br>`packages/coding-agent/src/modes/ask-mode/readonly-tools.ts`<br>`packages/coding-agent/src/modes/ask-mode/state.ts`<br>`packages/coding-agent/src/modes/components/diff.ts`<br>`packages/coding-agent/src/modes/components/dynamic-border.ts`<br>`packages/coding-agent/src/modes/components/extensions/dashboard-runtime.ts`<br>`packages/coding-agent/src/modes/components/pause-screen.ts`<br>`packages/coding-agent/src/modes/components/schema-driven-wizard.ts`<br>`packages/coding-agent/src/modes/components/status-line-segment-editor.ts`<br>`packages/coding-agent/src/modes/controllers/selector-controller.ts`<br>`packages/coding-agent/src/modes/debug-mode/log-server.ts`<br>`packages/coding-agent/src/modes/debug-mode/state.ts`<br>`packages/coding-agent/src/modes/types.ts`<br>`packages/coding-agent/src/plan-mode/settings.ts`<br>`packages/coding-agent/src/prompts/agents/oracle.md`<br>`packages/coding-agent/src/prompts/system/ask-mode-off.md`<br>`packages/coding-agent/src/prompts/system/debug-mode-off.md`<br>`packages/coding-agent/src/prompts/system/plan-mode-subagent.md`<br>`packages/coding-agent/src/prompts/tools/apply-patch.md`<br>`packages/coding-agent/src/prompts/tools/ask-followup-question.md`<br>`packages/coding-agent/src/prompts/tools/mimo.md`<br>`packages/coding-agent/src/prompts/tools/patch.md`<br>`packages/coding-agent/src/prompts/tools/replace.md`<br>`packages/coding-agent/src/session/settings.ts`<br>`packages/coding-agent/src/slash-commands/commands/add-provider.ts`<br>`packages/coding-agent/src/tools/ask-followup-question.ts`<br>`packages/coding-agent/src/tools/auto-generated-guard.ts`<br>`packages/coding-agent/src/tools/bash-interactive.ts`<br>`packages/coding-agent/src/tools/builtin-names.ts`<br>`packages/coding-agent/src/tools/checkpoint.ts`<br>`packages/coding-agent/src/tools/computer/exposure.ts`<br>`packages/coding-agent/src/tools/render-utils.ts`<br>`packages/coding-agent/src/tools/resolve.ts`<br>`packages/coding-agent/src/tools/tool-errors.ts`<br>`packages/coding-agent/src/tools/tts.ts`<br>`packages/coding-agent/src/tools/xdev.ts`<br>`packages/coding-agent/src/tui/code-cell.ts`<br>`packages/coding-agent/src/tui/file-list.ts`<br>`packages/coding-agent/src/tui/hyperlink.ts`<br>`packages/coding-agent/src/tui/index.ts`<br>`packages/coding-agent/src/tui/output-block.ts`<br>`packages/coding-agent/src/tui/status-line.ts`<br>`packages/coding-agent/src/tui/tree-list.ts`<br>`packages/coding-agent/src/tui/types.ts`<br>`packages/coding-agent/src/tui/utils.ts`<br>`packages/coding-agent/src/tui/width-aware-text.ts`<br>`packages/coding-agent/src/utils/sixel.ts` |
| OWP natives package | — | `packages/natives/native/embedded-addon.js`<br>`packages/natives/native/index.d.ts`<br>`packages/natives/test/windows-staging.test.ts` |
| OWP stats package | — | `packages/stats/src/aggregator.ts`<br>`packages/stats/src/db.ts` |
| OWP TUI package | — | `packages/tui/src/autocomplete.ts`<br>`packages/tui/src/components/settings-list.ts`<br>`packages/tui/src/overlays/extensions/inspector-panel.ts`<br>`packages/tui/src/overlays/extensions/types.ts`<br>`packages/tui/src/symbols.ts`<br>`packages/tui/src/terminal.ts`<br>`packages/tui/src/tools/web-search-types.ts`<br>`packages/tui/src/tools/web-search.ts`<br>`packages/tui/src/utils.ts`<br>`packages/tui/test/hook-input-timeout.test.ts`<br>`packages/tui/test/issue-848-repro.test.ts`<br>`packages/tui/test/keys.test.ts`<br>`packages/tui/test/status-line-loop.test.ts`<br>`packages/tui/test/status-line-model.test.ts`<br>`packages/tui/test/status-line-path.test.ts` |
| OWP utils package | — |  |
| OWP catalog package | — | `packages/catalog/src/compat/rules.json`<br>`packages/catalog/src/models.json`<br>`packages/catalog/src/compat/rules/classes/anthropic.kdl`<br>`packages/catalog/test/build.test.ts`<br>`packages/catalog/test/generated-policies.test.ts`<br>`packages/catalog/test/synthetic-provider.test.ts`<br>`packages/catalog/test/yolo-auto-provider.test.ts` |
| OWP Rust crates | — |  |
| OWP scripts | — | `scripts/eval-bench-runs.ts`<br>`scripts/session-stats/README.md` |
| OWP Python RPC | The fork's robomp subset: upstream renamed omp-rpc to robomp long ago, so the fork keeps a trimmed copy of upstream's robomp tree (56 upstream-identical files) plus its own refreshed web bundle assets | `python/robomp/LICENSE`<br>`python/robomp/docs/pr-review-handoff.md`<br>`python/robomp/src/issue_index.py`<br>`python/robomp/src/prompts/followup_release.md`<br>`python/robomp/src/prompts/kickoff_pr_review.md`<br>`python/robomp/src/prompts/kickoff_release.md`<br>`python/robomp/src/prompts/review_completion_reminder.md`<br>`python/robomp/src/prompts/system_append_pr_review.md`<br>`python/robomp/src/prompts/system_append_release.md`<br>`python/robomp/src/static/assets/index-BCntletT.js`<br>`python/robomp/src/static/assets/style-B9LxyhOi.css`<br>`python/robomp/src/static/index.html`<br>`python/robomp/tests/test_git_ops.py`<br>`python/robomp/tests/test_issue_index.py`<br>`python/robomp/tests/test_queue_dispatch.py`<br>`python/robomp/tests/test_retry.py`<br>`python/robomp/tests/test_status_contract.py`<br>`python/robomp/tests/test_tasks.py`<br>`python/robomp/tests/test_tasks_release.py`<br>`python/robomp/web/index.html`<br>`python/robomp/web/package.json`<br>`python/robomp/web/scripts/verify-cards.ts`<br>`python/robomp/web/scripts/verify-live.ts`<br>`python/robomp/web/src/App.tsx`<br>`python/robomp/web/src/api.ts`<br>`python/robomp/web/src/components/Browse.tsx`<br>`python/robomp/web/src/components/Events.tsx`<br>`python/robomp/web/src/components/GlassCard.tsx`<br>`python/robomp/web/src/components/IssueCard.tsx`<br>`python/robomp/web/src/components/IssueLink.tsx`<br>`python/robomp/web/src/components/LifecycleStepper.tsx`<br>`python/robomp/web/src/components/Logs.tsx`<br>`python/robomp/web/src/components/Pill.tsx`<br>`python/robomp/web/src/components/Pipeline.tsx`<br>`python/robomp/web/src/components/Releases.tsx`<br>`python/robomp/web/src/components/ThemeToggle.tsx`<br>`python/robomp/web/src/components/Trigger.tsx`<br>`python/robomp/web/src/components/shell/Rail.tsx`<br>`python/robomp/web/src/components/shell/Shell.tsx`<br>`python/robomp/web/src/components/shell/TopBar.tsx`<br>`python/robomp/web/src/components/shell/Vitals.tsx`<br>`python/robomp/web/src/components/views/Activity.tsx`<br>`python/robomp/web/src/components/views/Operations.tsx`<br>`python/robomp/web/src/components/views/Triage.tsx`<br>`python/robomp/web/src/config.ts`<br>`python/robomp/web/src/env.d.ts`<br>`python/robomp/web/src/format.ts`<br>`python/robomp/web/src/main.tsx`<br>`python/robomp/web/src/state.ts`<br>`python/robomp/web/src/styles/index.css`<br>`python/robomp/web/src/theme.ts`<br>`python/robomp/web/src/types.ts`<br>`python/robomp/web/src/view.ts`<br>`python/robomp/web/src/work-items.contract.test.ts`<br>`python/robomp/web/src/work-items.test.ts`<br>`python/robomp/web/src/work-items.ts`<br>`python/robomp/web/test/fixtures/status-contract.json`<br>`python/robomp/web/tsconfig.json`<br>`python/robomp/web/vite.config.ts` |
| OWP documentation | — | `docs/ask_session.md`<br>`docs/bugs/ask-mode-switch-tool-missing.md`<br>`docs/bugs/bytecode-childprocess-binding.md`<br>`docs/bugs/debug-mode-lifecycle.md`<br>`docs/bugs/edit-tool-session-gaps.md`<br>`docs/bugs/explore-subagent-connection-error.md`<br>`docs/bugs/plan-mode-resolve-bug.md`<br>`docs/debug_session.md`<br>`docs/maintaining-owp-fork.md`<br>`docs/mode-registry-future-architecture.md`<br>`docs/notebook-tool-runtime.md`<br>`docs/web-native-feasibility.md` |
| OWP GitHub config | — |  |
| OWP root config and assets | — | `.dockerignore`<br>`.fallowrc.jsonc`<br>`.gitattributes`<br>`AGENTS.md`<br>`Cargo.toml`<br>`Dockerfile`<br>`LICENSE`<br>`bunfig.toml`<br>`package.json`<br>`packages/tsconfig.workspace.json`<br>`rust-analyzer.toml`<br>`rust-toolchain.toml`<br>`rustfmt.toml`<br>`tsconfig.base.json`<br>`tsconfig.json`<br>`tsconfig.tools.json` |
| Command dispatch composition | Upstream satellite command arrays spread into the registry; fork deltas stay inline (last-wins) for add-provider/refresh-models/drop/agent/ask | `packages/coding-agent/src/modes/controllers/event-controller.ts`<br>`packages/coding-agent/src/slash-commands/builtin-modes.ts`<br>`packages/coding-agent/src/slash-commands/builtin-registry.ts`<br>`packages/tui/src/overlays/extensions/extension-list.ts` |
| Forklift harness | Project registry and install lock consumed by the forklift sync harness; registry.yaml is rewritten by forklift render. The doctor/init/maintain skills are the agent-facing entry points installed by forklift install | `.forklift/`<br>`.omp/skills/forklift-doctor/`<br>`.omp/skills/forklift-init/`<br>`.omp/skills/forklift-maintain/`<br>`.omp/skills/sync-upstream/`<br>`.omp/commands/forklift-bootstrap.md`<br>`.omp/commands/forklift-feature.md`<br>`.omp/commands/forklift-sync.md`<br>`.omp/commands/forklift-audit.md`<br>`.omp/commands/forklift-rebuild.md`<br>`.omp/commands/forklift.md`<br>`AGENT.md` |
| OWP fork test suite | The fork's own test suite under packages/coding-agent/test - upstream's test directory was removed on purpose, these are the fork's replacements and additions | `packages/coding-agent/test/agent-session-message-pipeline.test.ts`<br>`packages/coding-agent/test/agent-session-plan-mode-convergence.test.ts`<br>`packages/coding-agent/test/config/schema-introspector.test.ts`<br>`packages/coding-agent/test/discovery/agent-fields.test.ts`<br>`packages/coding-agent/test/discovery/agents-monorepo-skills.test.ts`<br>`packages/coding-agent/test/discovery/pi-provider.test.ts`<br>`packages/coding-agent/test/edit-blackbox.test.ts`<br>`packages/coding-agent/test/edit-mode.test.ts`<br>`packages/coding-agent/test/edit-tool-details.test.ts`<br>`packages/coding-agent/test/extensions/skill-grouping.test.ts`<br>`packages/coding-agent/test/file-lock.test.ts`<br>`packages/coding-agent/test/interactive-mode-plan-review.test.ts`<br>`packages/coding-agent/test/interactive-mode-status.test.ts`<br>`packages/coding-agent/test/modes/ask-mode/ask-mode-context-injection.test.ts`<br>`packages/coding-agent/test/modes/ask-mode/ask-mode-enforcement.test.ts`<br>`packages/coding-agent/test/modes/ask-mode/ask-mode-guard.test.ts`<br>`packages/coding-agent/test/modes/ask-mode/bash-readonly.test.ts`<br>`packages/coding-agent/test/modes/ask-mode/tool-guard.test.ts`<br>`packages/coding-agent/test/modes/debug-mode/debug-log-server.test.ts`<br>`packages/coding-agent/test/modes/debug-mode/debug-mode-context-injection.test.ts`<br>`packages/coding-agent/test/modes/extensions/extension-state-manager.test.ts`<br>`packages/coding-agent/test/modes/interactive-mode/handle-switch-mode.test.ts`<br>`packages/coding-agent/test/modes/mode-segment-status.test.ts`<br>`packages/coding-agent/test/plan-mode/approved-plan.test.ts`<br>`packages/coding-agent/test/plan-mode/plan-mode-resolve.test.ts`<br>`packages/coding-agent/test/plan-mode/plan-run.test.ts`<br>`packages/coding-agent/test/plan-mode/storage.test.ts`<br>`packages/coding-agent/test/sdk-session-directory-event.test.ts`<br>`packages/coding-agent/test/session/skill-rediscovery-new-session.test.ts`<br>`packages/coding-agent/test/settings-manager.test.ts`<br>`packages/coding-agent/test/settings-provenance.test.ts`<br>`packages/coding-agent/test/slash-commands/debug.test.ts`<br>`packages/coding-agent/test/slash-commands/plan-subcommands.test.ts`<br>`packages/coding-agent/test/status-line-overflow.test.ts`<br>`packages/coding-agent/test/status-line-time-spent.test.ts`<br>`packages/coding-agent/test/tools/index.test.ts`<br>`packages/coding-agent/test/tools/provider-schema-compatibility.test.ts`<br>`packages/coding-agent/test/tools/schema-validation.test.ts`<br>`packages/coding-agent/test/tools/switch-mode.test.ts`<br>`packages/coding-agent/test/tools/web-search-exa.test.ts`<br>`packages/coding-agent/test/tools/web-search-google-ai.test.ts`<br>`packages/coding-agent/test/tools/web-search-serpapi.test.ts`<br>`packages/coding-agent/test/vibe/vibe-runtime.test.ts`<br>`packages/coding-agent/test/web/search/fork-engines.test.ts`<br>`packages/coding-agent/test/write-xdev-dispatch.test.ts` |
| OWP robomp web bundle | The robomp web bundle the fork keeps and refreshes - upstream's robomp app is otherwise absent from the fork | `python/robomp/src/static/assets/index-BCntletT.js`<br>`python/robomp/src/static/assets/style-B9LxyhOi.css`<br>`python/robomp/src/static/index.html` |

## Verification Commands
- **Typecheck**: `bun check`
- **Test**: `bun test`
- **Lint**: `bun run lint`

## Divergences & Intentional Removals
**Divergences (upstream-owned, take upstream):**

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

**Intentional removals (deleted on purpose):**

- `.omp/commands/sync-upstream.md` — the fork's sync command was renamed to .omp/commands/forklift-sync.md so the harness command family is uniform (/forklift-*); the forklift install writes the new stub and removes the old one
- `packages/coding-agent/src/edit/apply-patch/` — JS apply-patch module retired - native crates/pi-edit/src/modes/apply_patch.rs adopted (Phase B, 1ef85e092c)
- `packages/coding-agent/src/edit/modes/apply-patch.lark` — JS apply-patch grammar retired with the JS apply-patch executor - the native grammar owns parsing
- `packages/coding-agent/src/edit/sloppy.lark` — JS sloppy grammar retired with the JS sloppy executor - native modes/sloppy adopted
- `packages/coding-agent/src/edit/sloppy.md` — JS sloppy executor documentation retired with the JS sloppy executor
- `packages/coding-agent/src/edit/sloppy.test.ts` — JS sloppy executor tests retired with the JS sloppy executor - native sloppy mode is covered by crates/pi-edit tests
- `python/robomp/` — Upstream's robomp tree (134 files) is not shipped as-is. The fork keeps 59 files under python/robomp/ - 56 upstream-identical copies plus its own refreshed web bundle assets - registered under the feature OWP Python RPC, and drops the other 78 upstream paths on purpose: the Python service, the GitHub backend and the web app sources, which would otherwise be restored by the next sync. The pattern covers the whole directory, so it also matches the 59 kept files; the rebuild applies a removal pattern only to the paths the fork actually deleted, so the kept subset survives.
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
- `.omp/skills/sync-upstream/SKILL.md.template` — legacy harness template — replaced by the forklift-rendered SKILL.md (45d420a076)
- `.omp/skills/sync-upstream/feature-registry.yaml` — legacy feature registry — superseded by .forklift/registry.yaml (45d420a076)
- `.omp/skills/sync-upstream/footprint-baseline.json` — legacy footprint baseline — superseded by .forklift/footprint-baseline.json (45d420a076)
- `.omp/skills/sync-upstream/generate-skill-md.ts` — legacy SKILL.md generator — superseded by `forklift render` (45d420a076)
- `.omp/skills/sync-upstream/sync.ts` — legacy sync runner — superseded by `forklift sync` (45d420a076)
- `.omp/skills/reorganize-history/SKILL.md` — reorganize-history skill — lifted into `forklift reorg` (45d420a076)
- `.omp/skills/reorganize-history/organize.ts` — reorganize-history script — lifted into `forklift reorg` (45d420a076)
- `.omp/commands/reorganize-fork.md` — legacy slash command for the retired reorganize-history skill (45d420a076)

## Fork Maintenance Situations
The person asking for work on this fork describes **what they want**, not how the harness works. Match their request to a situation below, read that procedure, and follow it. Never ask them which command to run, which registry field to fill, or which files a feature owns — that is the procedure's work, not theirs.

| They say something like | What you do | Where the procedure is |
| --- | --- | --- |
| "set this fork up", "make this repo fork-aware", "we are forking this project" | draft the registry, install the harness, and hand back the worklist of what still needs claiming | the `forklift-init` skill |
| "I just added a feature", "make sure my new code survives the next sync" | register the feature so the next rebase cannot drop it | the `forklift-maintain` skill, § *Register a feature* |
| "sync with upstream", "pull in upstream's changes", "rebase onto upstream" | size the conflict surface, rebase, resolve, gate, and push | the `sync-upstream` skill |
| "is the fork healthy", "what drifted", "does the registration still match the code" | audit the registration against the tree and report the findings | the `forklift-doctor` skill |
| "the rebase went wrong", "features got dropped", "the history is too tangled to rebase" | triage the history and rebuild it topically | the `forklift-maintain` skill, § *Rebuilding the history* |
<!-- GENERATED:FORKLIFT_END -->

## Repository Specific Notes

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
   `feature-registry.yaml` in the same commit. Then regenerate SKILL.md with `forklift render`
   so the Owned Symbols tables stay current. Don't wait for the next sync to discover the gap.

### Contact surface audit

Before merging a new feature commit, audit its sdk.ts diff:
- Count the number of separate insertion/modification hunks
- If > 2 hunks, consider whether the logic can be moved to a dedicated file
- If the feature adds a parameter to `rebuildSystemPrompt` or `buildSystemPromptInternal`,
  consider whether the value can be read from `session` or `settings` instead of threaded

## Post-Rebase Bookkeeping

- **Review promotion candidates.** Check if any no-op stubs now have sufficient implementation need to be promoted to real code.
- **Fork Features table.** `generate-skill-md.ts` refreshes the Fork Features table in `docs/maintaining-owp-fork.md` from git history. It also rewrites SKILL.md from the legacy template — re-run `forklift render` afterwards so the skill stays forklift-managed.
