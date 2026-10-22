<!-- forklift v1 -->
# Forklift: Bootstrap

Set up this fork (oh-wiblo-pi) for forklift: detect its remotes and layout, draft the feature
registry from its history, and hand the operator the migration worklist.

## Steps

1. Read the `forklift-init` skill — it carries the detection rules, the registry skeleton and the
   schema every field must satisfy.
2. Confirm the fork shape first, and say it out loud before writing anything:
   ```bash
   git remote -v
   git branch -vv
   ls -d .forklift 2>/dev/null || echo "no .forklift yet"
   ```
   This is a fork when it rebases against an upstream remote (`upstream/main`);
   otherwise it is the upstream itself and forklift is consumed, not installed.
3. Scaffold and draft the registry (every generated feature starts as `status: draft`):
   ```bash
   cp "$(command -v forklift | xargs dirname)/../../templates/registry.template.yaml" .forklift/registry.yaml
   ```
   Fill it from the fork's own commits — `git log --name-only upstream/main..main`
   grouped by file overlap — then set `harness.fork` / `harness.upstream` from the remotes above and
   `expected_fork_commit_count` to the measured `git rev-list --count upstream/main..main`.
4. Install the harness into the agent's adapter directories and render the artifacts:
   ```bash
   forklift install
   forklift render --registry .forklift/registry.yaml
   ```
5. Run the audit and hand back the worklist — the point of the bootstrap is the list, not a green board:
   ```bash
   forklift doctor
   ```
   Draft features are reported, not enforced, so every finding is real work the operator still owns.

## Done means

`.forklift/registry.yaml` exists and validates, the skills are installed, `forklift doctor` runs, and
the operator has the list of paths the fork touches that nobody has claimed yet. Do not promote a
draft feature to active on your own — that is the operator's call, per feature.
