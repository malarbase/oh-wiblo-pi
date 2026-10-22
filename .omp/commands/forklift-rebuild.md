<!-- forklift v1 -->
# Forklift: Rebuild the fork's history

Use this when the user says something like "the rebase went wrong", "features got dropped", "the history is too tangled to rebase".

**What it does:** triage the history and rebuild it topically

**Procedure:** read the `forklift-maintain` skill, § *Rebuilding the history* and follow it.

It carries the decision tree for when a rebuild is justified and the rules for telling an
intentional deletion from an accidental one.

**Commands:**

```bash
forklift reorg
```

Rare, non-routine, never part of a routine sync. The rebuild writes a new history on a side
branch and swaps it in only after the operator has compared it with the old one.
