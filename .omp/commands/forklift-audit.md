<!-- forklift v1 -->
# Forklift: Check the fork's health

Use this when the user says something like "is the fork healthy", "what drifted", "does the registration still match the code".

**What it does:** audit the registration against the tree and report the findings

**Procedure:** read the `forklift-doctor` skill and follow it.

Each check names its own failure mode, its own remediation, and what it means for this fork.

**Commands:**

```bash
forklift doctor
forklift verify
```

Report the findings; do not fix them yet. For each one, say what it means for this fork, what
the fix is, and what the risk of taking it. The operator decides — a check that "proves wrong"
needs a decision, not a silent edit.
