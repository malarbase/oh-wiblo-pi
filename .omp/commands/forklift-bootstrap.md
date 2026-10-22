<!-- forklift v1 -->
# Forklift: Set up this fork

Use this when the user says something like "set this fork up", "make this repo fork-aware", "we are forking this project".

**What it does:** draft the registry, install the harness, and hand back the worklist of what still needs claiming

**Procedure:** read the `forklift-init` skill and follow it.

It carries the detection rules, the registry skeleton, and the schema every field must satisfy.

**Commands:**

```bash
forklift install
forklift doctor
```

A fork is a fork when it rebases against an upstream remote; otherwise it is the upstream itself
and forklift is consumed, not installed. The point of the bootstrap is the worklist, not a green
board: draft features are reported, not enforced.
