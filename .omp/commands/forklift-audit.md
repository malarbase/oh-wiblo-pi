<!-- forklift v1 -->
# Forklift: Audit

Audit this fork (oh-wiblo-pi) against its own registration: does the registry still describe the
tree, and does the fork still pass its own checks?

## Steps

1. Run the drift audit and read every finding before changing anything:
   ```bash
   forklift doctor
   ```
   Each check names its own failure mode: registry completeness (a fork commit touches a path
   nobody claimed), stale paths (a claimed path does not exist), feature coverage (a behavior
   feature has no protecting test), import liveness (a claimed source nothing imports), commit
   survival (the fork's commit count moved), deletion audit (a claimed path upstream deleted),
   version drift (the stamped artifacts disagree with the harness), upstream drift forecast (what
   the next sync will touch).
2. Run the fork's own checks — conflict markers, symbol health, commit survival, the protecting
   tests, typecheck, deletion audit:
   ```bash
   forklift verify
   ```
3. Report, do not fix yet. For each finding: what it means for this fork, what the fix is, and
   what the risk of taking it. The operator decides; a check that "proves wrong" needs a decision,
   not a silent edit.
4. For the upstream forecast specifically, size the next sync before promising anything:
   ```bash
   forklift doctor --check 8
   ```

## Done means

A list of findings, each with its check name, its cause and its remediation — and no file changed.
If everything is green, say so plainly and report the conflict surface for the next sync, because
that is the number that decides how much work the next sync is.
