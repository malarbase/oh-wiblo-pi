---
name: reorganize-history
description: Rebuild the owp fork's interleaved commit history into ~20 topical commits by copying final tree states from feature-registry.yaml. Adjudicates fork-side deletions first. Rare operation — not part of routine sync.
---

# Reorganize Fork History (owp)

Rebuild `fork/main` as one topical commit per registered feature via **tree reconstruction**: branch from `upstream/main`, copy each feature's final file state, commit once per feature. No patch replay → no conflicts by construction.

## Purpose

This is a rare, deliberate operation — never part of routine sync (`sync.ts` handles that). Use it when:

- The interleaved commit history makes future rebases painful (past rebases silently dropped files).
- Deletions need adjudication: which fork-side deletions are intentional vs accidental fallout from a messy history.

Ground rules baked into `organize.ts`:

- **Ambiguous deletions default to restore** (branching from upstream keeps them). Register intentional ones in § removals to suppress that.
- The working tree must be clean on `main`; user changes are never touched.
- Every rebuild leaves an annotated `backup/pre-reorg-YYYY-MM-DD` tag before touching anything.

## Workflow

1. **Triage** (read-only, always exit 0):
   ```bash
   bun .omp/skills/reorganize-history/organize.ts
   ```
   Prints: heads/base, deletion adjudication (converged / registered / accidental-candidate with the deleting commit of each candidate), per-feature A/M/shared-M/D partition preview, and any unregistered additions/modifications that would abort a rebuild.

2. **Review the accidental-deletion report with the user.** For each deleting commit whose subject matches `/remove|delete|drop/i`, its whole deleted-file set is a candidate for § removals. Deletions from `wip:`/`fix:`/`restore:` commits stay unregistered — the rebuild restores those files from upstream automatically. Collapse ≥5 files under one directory into the directory pattern; otherwise one entry per path/glob.

3. **Seed § removals** in `.omp/skills/sync-upstream/feature-registry.yaml` (`removals:` section, entries `{ path, reason }`; same pattern language as everywhere else) and regenerate:
   ```bash
   bun .omp/skills/sync-upstream/generate-skill-md.ts
   ```

4. **Dry-run check** (optional but recommended):
   ```bash
   bun .omp/skills/reorganize-history/organize.ts --rebuild --stay-on-wip
   ```
   Leaves the rebuilt history on branch `reorganize-wip` without swapping `main`. Inspect with `git log --oneline upstream/main..reorganize-wip` and `git diff --name-status reorganize-wip main`. Discard: `git checkout main && git branch -D reorganize-wip && git tag -d backup/pre-reorg-*`.

5. **Rebuild for real** (requires clean tree on `main`):
   ```bash
   bun .omp/skills/reorganize-history/organize.ts --rebuild
   ```
   Pipeline: preflight → backup tag → classify delta → 3-way overlays pre-built (`git merge-file`) → branch `reorganize-wip` from `upstream/main` → one `feat(owp): <feature>` commit per registry feature (plain copies + overlay overwrites; empty groups skipped with warning, never empty commits) → one `chore(owp): remove <path> — <reason>` commit per removal → integrity gate (tree may only differ from old main by restored files and dropped divergence edits) → verification gate → swap `main` and write shared sync state. Any failure aborts before or at the gate with `main` untouched.

   The verification gate requires **no new failures** relative to a baseline `sync.ts --verify` captured on the pre-reorg tree. The deletion audit reads the `main` ref, so before the swap it may flag exactly the files being restored — never anything else. Checks that already failed before the reorg (e.g. repo-wide typecheck debt) are reported as inherited, not regressions.

6. **Force-push** (history rewritten):
   ```bash
   git push origin main --force-with-lease
   ```

## Rollback

- Before swap: `backup/pre-reorg-YYYY-MM-DD(-N)` tag holds the original `main`; discard the wip branch and tag.
- After swap: `git reset --hard backup/pre-reorg-YYYY-MM-DD`, or `bun .omp/skills/sync-upstream/sync.ts --revert` — it works because organize.ts writes the same `~/.omp/sync-state.json`.

## Edge handling

- A § removals pattern removes exactly the upstream files the fork already deleted (classified before anything is staged) — never surviving fork files under the same directory. Registry-side, prefer precise patterns: a broad directory pattern also silences future deletion-audit violations beneath it.
- Branch/tag name collisions get `-N` suffixes (same scheme as `resolveTagName` in sync.ts).
- Missing refs in `git cat-file` count as converged (file is gone upstream too — nothing to restore).
- `git merge-file` conflicts abort the rebuild before anything is staged.
- Files owned by multiple features go to the first matching registry entry.
- Unregistered additions/modifications abort the rebuild — register them first.

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
