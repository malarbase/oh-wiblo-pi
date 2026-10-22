<!-- forklift v1 -->
# Forklift: Protect a new feature

Use this when the user says something like "I just added a feature", "make sure my new code survives the next sync".

**What it does:** register the feature so the next rebase cannot drop it

**Procedure:** read the `forklift-maintain` skill, § *Register a feature* and follow it.

It carries the rules that decide where a path belongs, what a protecting test is for, and how to
register a feature without guessing.

**Commands:**

```bash
forklift render
forklift install
forklift doctor
```

The registry is the fork's memory: a path it does not claim is a path the next rebase is free to
overwrite. Register the feature after the code lands.
