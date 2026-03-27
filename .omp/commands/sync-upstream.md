# Sync Upstream

Rebase `fork/main` against `upstream/main` (omp → owp).

## Steps

1. Read the `sync-upstream` skill — it contains the conflict resolution decision tree and feature ownership registry.
2. Run the sync script:
   ```bash
   bun .omp/skills/sync-upstream/sync.ts
   ```
3. If conflicts are reported, resolve them using the decision tree from the skill, then run `git rebase --continue` and re-run the script to check for more.
4. If upstream changed `packages/natives/` or `crates/`, rebuild the native addon before testing:
   ```bash
   mise exec -- bun --cwd=packages/natives run build:native
   ```
5. Verify `~/.omp/agent/models.yml` is still valid — start omp and check for any `Schema error: /providers/.../...` in the output. If the schema changed in `src/config/model-registry.ts`, update `models.yml` to match (e.g. a `discovery.type` value may no longer be accepted).
6. Update `docs/maintaining-owp-fork.md` § Last Sync Point with the values it prints.
7. Push with `--push` flag or manually:
   ```bash
   bun .omp/skills/sync-upstream/sync.ts --push
   ```

## Escalation

If a conflict requires your judgment (semantic clash between upstream and an owp feature), stop and ask the user. Use the ESCALATE format defined in the skill.
