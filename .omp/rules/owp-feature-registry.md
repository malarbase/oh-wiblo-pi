---
description: Remind agent to update feature-registry.yaml when modifying fork-owned symbols or shared files
globs:
  - "packages/coding-agent/src/modes/**"
  - "packages/tui/src/**"
  - "packages/ai/src/**"
  - "packages/coding-agent/src/sdk.ts"
alwaysApply: false
---

When modifying shared files that contain OWP fork-owned symbols (such as `settings-selector.ts`, `settings-list.ts`, `theme.ts`, `sdk.ts`, `model-registry.ts`):
1. Ensure `.omp/skills/sync-upstream/feature-registry.yaml` is updated under `owned_symbols` to list the new or modified symbol names.
2. Run `bun .omp/skills/sync-upstream/generate-skill-md.ts` to update the sync-upstream `SKILL.md`.
