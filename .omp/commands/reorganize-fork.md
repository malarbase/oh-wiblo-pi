# Reorganize Fork History

Rebuild `fork/main` into topical commits (one per registered feature) by copying final tree states — no patch replay, zero conflicts. Rare operation; adjudicates fork-side deletions first.

## Steps

1. Read the `reorganize-history` skill — it defines the deletion policy and rebuild pipeline.
2. Run the triage report (read-only):
   ```bash
   bun .omp/skills/reorganize-history/organize.ts
   ```
3. Review the accidental-deletion report with the user. Decide which deleting commits were intentional (`remove`/`delete`/`drop` subjects) vs accidental (`wip:`/`fix:`/`restore:` commits).
4. Seed intentional deletions into `feature-registry.yaml` § removals and regenerate:
   ```bash
   bun .omp/skills/sync-upstream/generate-skill-md.ts
   ```
5. Rebuild (optionally with `--stay-on-wip` first to inspect the result branch):
   ```bash
   bun .omp/skills/reorganize-history/organize.ts --rebuild
   ```
6. Review the printed summary (commit count, restored files) and confirm `sync.ts --verify` passed.
7. History was rewritten — force-push with lease:
   ```bash
   git push origin main --force-with-lease
   ```

## Escalation

If classification is ambiguous (a deletion tied to both a feature and a cleanup commit), stop and ask the user. Default policy otherwise: restore unless intentionally removed. Use the ESCALATE format defined in the skill.
