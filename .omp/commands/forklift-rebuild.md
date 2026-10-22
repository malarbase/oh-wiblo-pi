<!-- forklift v1 -->
# Forklift: Rebuild History

Rebuild this fork's (oh-wiblo-pi) history into one topical commit per registered feature. Rare —
reach for it when rebases have gone wrong (features silently dropped) or when the history is too
interleaved to rebase cleanly. It is not part of a routine sync.

## Steps

1. Read the `forklift-maintain` skill — it carries the decision tree for when a rebuild is
   justified, and the deletion adjudication rules.
2. Triage first, and show the operator the report before anything moves:
   ```bash
   forklift reorg
   ```
   It is read-only: the heads, the merge base, which deletions are converged (gone upstream too),
   which are registered in `removals`, which are accidental candidates (each with the commit that
   deleted them), and the per-feature partition of the rebuild.
3. Review the accidental-deletion report with the operator. For each deleting commit whose subject
   says it removed something, decide: intentional (record it in `removals` with the reason) or
   accidental (the rebuild restores it from upstream).
4. Seed `removals` in `.forklift/registry.yaml`, then render:
   ```bash
   forklift render --registry .forklift/registry.yaml
   ```
5. Rebuild on a side branch and leave `main` alone:
   ```bash
   forklift reorg --rebuild --stay-on-wip
   ```
   Inspect before swapping:
   ```bash
   git log --oneline upstream/main..reorganize-wip
   git diff --name-status reorganize-wip main
   ```
6. Only after the operator has seen the rebuilt history: swap it in and push.
   ```bash
   git checkout main && git reset --hard reorganize-wip && git branch -D reorganize-wip
   git push origin main --force-with-lease
   ```
   A backup tag is created before the swap — that is the way back.

## Done means

The rebuilt history is one commit per feature, the deletions are adjudicated and recorded, the
operator has compared the rebuilt branch against the old one, and the swap happened only after they
said so. If the verification gate fails, the rebuild aborts with `main` untouched — read the failure,
fix the cause, and rebuild; do not force the swap past a red gate.
