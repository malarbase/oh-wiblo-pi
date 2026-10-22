<!-- forklift v1 -->
# Forklift: Sync this fork with upstream

Use this when the user says something like "sync with upstream", "pull in upstream's changes", "rebase onto upstream".

**What it does:** size the conflict surface, rebase, resolve, gate, and push

**Procedure:** read the `sync-upstream` skill and follow it.

It carries the conflict resolution decision tree, the upstream-deleted module protocol, and the
rules for reading the fork's own record of what it owns.

**Commands:**

```bash
forklift doctor --check 8
forklift sync
```

Resolve each reported conflict through the skill's Conflict Walk, run the touched features'
protecting tests, then `git rebase --continue` and re-run the runner. A conflict that needs
your judgment — a semantic clash between upstream and a fork feature — is an escalation: stop and
use the ESCALATE format the skill defines.
