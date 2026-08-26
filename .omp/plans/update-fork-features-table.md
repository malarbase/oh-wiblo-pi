# Update Fork Features Table Plan

## Context

The Fork Features table in `docs/maintaining-owp-fork.md § Fork Features` has **stale commit hashes** (they drift on every rebase) and is **missing ~15 recent feature commits** that landed after the last table update (`36759ef23`). The task: run `git log --oneline --reverse upstream/main..HEAD`, compare against the table, and rebuild it with correct hashes and missing entries.

## Approach

### Step 1: Generate the canonical commit list

```bash
git log --format="%h %s" --reverse upstream/main..HEAD
```

This produces 69 commits. The table currently has ~55 entries with wrong hashes.

### Step 2: Rebuild the Fork Features table

Replace the entire table block (lines ~47–115 of `docs/maintaining-owp-fork.md`) with a new table that:

1. **Uses current hashes** from the git log (not the stale ones in the table)
2. **Adds missing feature commits** — commits that change code/tooling but aren't in the table:
   - `542937c68` — Fix /plan load and /plan run subcommand implementations
   - `f312ba888` — fix(owp): restore lost /refresh-models slash command
   - `96445284e` — fix(hook-input): prefill input with defaultValue
   - `8f382d778` — feat(tools): replace exit_plan_mode with switch_mode tool
   - `9cb07fc3a` — feat(ask-mode): restore read-only enforcement via in-tool guards
   - `c5f2a934c` — feat(coding-agent): add /add-provider slash command with wizard and persistence
   - `575dc707d` — fix(plan-mode): respect plan.storage setting in resolve handler
   - `fab145cfb` — fix(coding-agent): mode context stale instructions, always-available switch_mode, extensions UI crash
   - `086cdd535` — feat(coding-agent): add mimo edit mode, streaming edit helpers, and ask/plan extensions
   - `ea5d35b03` — fix(plan-mode): fix proposal handler registration and stabilize plan mode tests
   - `56b7caa37` — fix(sync-upstream): fallback gracefully when git fetch upstream is offline
   - `802e7ab51` — docs(sync-upstream): add packages/catalog/ to feature registry and regenerate SKILL.md
   - `11bbdee3b` — feat(extensions): restore skill grouping tree hierarchy, axis cycling, and group toggles
   - `c8bf3dcfd` — feat(tui): add settings provenance layer badges and scope toggles
   - `2bebf7e6f` — docs(sync): update sync-upstream no-op handling and bump Last Sync Point to 5039b33a1
   - `3e71dbdf8` — feat(web/search): separate google standard search and google-ai provider
   - `e07a6eef2` — fix(modes): restore status line indicators and feedback for ask and debug modes
   - `7b61bd957` — fix(build): hard-error on stale native addon, pass host PATH through Bazel sandbox
   - `af62ebc93` — fix(plan-mode): compute finalPlanFilePath in propose path for plan.storage project
   - `17ba5e74f` — fix(plan-mode): compute finalPlanFilePath in propose path, update install-binary docs

3. **Skips pure table-update commits** — commits whose only change is updating the table itself (docs-only commits like `be03a06ac`, `0b8c81baa`, `36759ef23`, etc.) get one consolidated "docs: table updates" entry or are omitted.

4. **Updates commit count** — change "~68 feature commits" to the actual count (~69 total, ~55 feature/code commits excluding pure docs/table-update commits).

### Step 3: Update the note about hash drift

The existing note says "Commit hashes change on every rebase." Keep it but make sure it's accurate.

## Critical Files & Anchors

- `docs/maintaining-owp-fork.md` — lines 47–115 (the Fork Features table block)
- `.omp/skills/sync-upstream/feature-registry.yaml` — the source of truth for owned files (read-only reference, no changes needed)

## Verification

1. Run `git log --oneline --reverse upstream/main..HEAD | wc -l` → expect 69
2. Count rows in the new table → should match ~55 feature/code commits (excluding pure table-update docs commits)
3. Verify every hash in the new table exists in the git log:
   ```bash
   git log --format="%h" upstream/main..HEAD | grep -c "$(grep -oP '`[a-f0-9]{9}`' docs/maintaining-owp-fork.md | tr -d '`' | head -55)"
   ```
4. Spot-check 3 random rows: hash, feature description, owned files should match the actual commit

## Assumptions

- Pure docs-only commits that just update the table itself don't need their own table rows (they're metadata about the table, not features).
- The feature description comes from the commit message, abbreviated to fit the table format.
- Owned files come from the feature registry (`feature-registry.yaml`) or from the commit diff.
