---
name: forklift-maintain
description: The judgment half of maintaining a forklift-managed fork — which registry section a path belongs in, what an advisory sentence should say, and the reorg decision tree. Run from the target fork repository.
---
<!-- forklift v1 -->

# forklift-maintain

`forklift check`, `forklift register`, and `forklift reorg` are mechanical: each does exactly what its flags say and never invents policy. This skill carries the decisions those commands cannot make for you — where a path belongs, what an advisory sentence must say, and when a history rewrite is justified.

## Setup

```bash
cd "$(git rev-parse --show-toplevel)"
test -f .forklift/registry.yaml || echo "MISSING: .forklift/registry.yaml (run forklift-init)"
```

Every command below runs in the fork repo you are standing in. `forklift` resolves from PATH after a global install; from a checkout, use `bun <forklift>/bin/forklift` with the same flags.

## Usage

```bash
forklift check                    # detect drift in generated artifacts, repair them, exit 1 if drift found
forklift check --dry-run          # report drift, write nothing
forklift check --json             # {artifacts: [{path, state, action}], ok}
forklift register                 # list fork-touched paths the registry does not claim, write nothing
forklift register --accept        # classify the same paths into owning sections and write the registry
forklift status                   # shared sync state: last sync point, phase, upstream head
forklift verify                   # the verification suite (conflict markers, symbols, commit survival, tests, typecheck)
forklift diff                     # what a sync would do, without touching anything
forklift diff --json              # machine-readable preview
forklift reorg                    # triage: read-only history analysis, exit 0
forklift reorg --rebuild          # rebuild fork history topically (rare — see the decision tree)
```

## What each command repairs

| Command | Writes | Never writes |
| --- | --- | --- |
| `forklift check` | generated artifacts only (skill doc, AGENT.md section, rules file, extension constants) | git state, the registry |
| `forklift register --accept` | the registry only (new `owned_paths` / `divergences` entries) | git state, generated artifacts |
| `forklift reorg --rebuild` | git history, then the same sync state/log as `forklift sync` | generated artifacts, the registry |
| `forklift sync` | git history, sync state (`harness.sync_state_path`), sync log (`harness.sync_log_path`) | the registry |

`forklift check --dry-run` and `forklift diff` write nothing at all — use them first, always.

## Deciding where a path goes

`forklift register` prints every fork-touched path the registry does not claim. Classify each by asking, in order:

1. **Does a commit subject name a feature that should own this path?** It belongs in that feature's `owned_paths`. Prefer ours when it conflicts with upstream; a protecting test belongs in `protecting_tests`.
2. **Is the path in `harness.shared_files`?** It belongs in `divergences` with a written `reason` naming what we intentionally keep. `--accept` writes the placeholder `"shared file — needs a written reason"` — **replace it with a real reason in the same edit**; a placeholder that ships is worse than an unregistered path.
3. **Neither?** `--accept` still proposes `divergences`, and exits 1 when the path sits inside `harness.project.source_roots` and matches nothing classifiable. Write that entry by hand: a path the fork modified but cannot explain is a fork-owned feature you have not named yet.

Rules that keep the registry honest:

- One path, one section. A path in two features resolves to the first registry entry — duplicate ownership is a silent coin flip.
- A path the fork does not override goes in `divergences`, never `owned_paths`; registering it invites prefer-ours resolutions that overwrite upstream.
- A path gone from the fork on purpose goes in `removals` with a `reason`. Ambiguity defaults to **restore**: the rebuild restores anything unclassified, so an unrecorded deletion comes back.
- `expected_fork_commit_count` is a verified measurement, not a target. Update it only after a rebuild or a deliberate commit-drop you can name in the commit.

## Advisory sentences

The rules file and the checklist extension carry short judgment text into the agent's own context (`harness.rules_advisory`, `harness.extension_advisory`). A sentence earns its place only if it states a decision the code cannot:

- bad: "Register paths in the registry." (mechanical — `forklift register` already says it)
- bad: "Be careful with shared files." (no decision)
- good: "A path under `harness.shared_files` that conflicts goes to `divergences` with a reason, never `owned_paths` — prefer-ours there silently reverts upstream."

## Fork commits and the maintained fork

```bash
forklift render                   # regenerate the skill doc, AGENT.md section, and the fork-commits table
forklift install                  # write this skill and the fork's rules/extension artifacts into the repo
forklift doctor                    # the drift audit (registry completeness, stale paths, coverage, liveness, commit survival, deletion audit, version)
```

Order matters: `render` regenerates from the registry, `install` writes what the registry describes, `doctor` audits the result. Skipping `render` before `install` ships stale text.

## Last Sync Point

After every successful sync, update the `Last Sync Point` bookkeeping in `harness.fork_doc`. `forklift sync` prints the exact values — the upstream head it rebased onto, the fork commit count, and the date — so copy them from its output rather than recomputing. A fork doc that lags is the first thing the next session misreads.

## `forklift reorg` — the decision tree

**Rare, non-routine, never part of a routine sync.** `forklift sync` is the everyday operation. A rebuild rewrites `fork.main`'s history — reach for it only when:

- past rebases have silently dropped files, or the interleaved history makes every future rebase painful; or
- deletions need adjudication: which fork-side deletions were intentional, and which were fallout from a messy history.

Tree reconstruction, not patch replay: branch from the upstream ref, copy each feature's final file state, one topical commit per feature. No conflicts by construction.

1. **Triage** — `forklift reorg` (read-only, exit 0). It prints heads and merge-base, deletion adjudication (converged / already registered in `removals` / accidental candidates with each deleting commit), a per-feature partition preview, and every unregistered addition or modification that would abort a rebuild.
2. **Review the accidental-deletion report with the user.** For each deleting commit whose subject matches `/remove|delete|drop/i`, its whole deleted-file set is a `removals` candidate. Deletions from `wip:`/`fix:`/`restore:` commits stay unregistered — the rebuild restores those files automatically. Collapse five or more files under one directory into the directory pattern; otherwise one entry per path or glob.
3. **Seed `removals`** in `.forklift/registry.yaml` (entries `{path, reason}`, same pattern language as everywhere), then `forklift render`.
4. **Dry run** — `forklift reorg --rebuild --stay-on-wip`. Leaves the rebuilt history on `reorganize-wip` without swapping `main`. Inspect `git log --oneline <upstream_branch>..reorganize-wip` and `git diff --name-status reorganize-wip main`. Discard with `git checkout main && git branch -D reorganize-wip && git tag -d backup/pre-reorg-*`.
5. **Rebuild** — `forklift reorg --rebuild`, requiring a clean tree on `main`. Pipeline: preflight → backup tag → classify the delta → 3-way overlays pre-built with `git merge-file` → branch from the upstream ref → one commit per feature in registry order (empty groups skipped, never empty commits) → one removal commit each → integrity gate → verification gate → swap `main` and write the shared sync state. Any failure aborts before or at the gate with `main` untouched.
6. **Force-push** — `git push origin main --force-with-lease` (history was rewritten).

The verification gate requires **no new failures** against a baseline `forklift verify` captured before the rebuild: a section that already failed is inherited, not a regression. Unregistered additions or modifications abort the rebuild — register them first.

## Rollback

- Before the swap: the `backup/pre-reorg-YYYY-MM-DD(-N)` tag holds the original `main`; discard the wip branch and tag.
- After the swap: `git reset --hard backup/pre-reorg-YYYY-MM-DD`, or `forklift sync --revert` — it works because `forklift reorg --rebuild` writes the same `harness.sync_state_path` that `forklift sync` reads.

## Escalation Format

When escalating to the user, output exactly:

```
ESCALATE
file: <path>
reason: <one sentence: what upstream changed and which feature it affects>
upstream: <brief description of upstream's version>
ours: <brief description of our version>
question: adapt our feature to upstream's change, or drop the upstream change?
```
