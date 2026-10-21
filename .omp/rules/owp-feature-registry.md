---
description: Remind agent to update the feature registry when modifying fork-owned symbols or shared files
globs:
  - "packages/coding-agent/src/modes/**"
  - "packages/tui/src/**"
  - "packages/ai/src/**"
  - "packages/coding-agent/src/sdk.ts"
alwaysApply: false
---
<!-- forklift v1 -->

When modifying shared files that contain fork-owned symbols (such as `settings-selector.ts`, `settings-list.ts`, `theme.ts`, `sdk.ts`, `model-registry.ts`):
1. Ensure `.forklift/registry.yaml` is updated under `owned_symbols` to list the new or modified symbol names.
2. Run `forklift render` to update the sync-upstream `SKILL.md`.

When modifying shared files that contain OWP fork-owned symbols (such as `settings-selector.ts`, `settings-list.ts`, `theme.ts`, `sdk.ts`, `model-registry.ts`):

1. Ensure `.forklift/registry.yaml` is updated under `owned_symbols`.
2. Run `forklift render` to update the sync-upstream `SKILL.md`.
