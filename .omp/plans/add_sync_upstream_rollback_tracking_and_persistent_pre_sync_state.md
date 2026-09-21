# Add sync-upstream rollback tracking and persistent pre-sync state

## Problem
The rebase at `3ec31e03a` → `upstream/main` introduced silent regressions (missing braces, docblocks, field declarations, argument order mismatches) that took hours to find and fix. The git reflog was the only recovery path, and the feature-checklist extension could only verify files, not the absence of parse errors. The sync script currently computes `origHead` in memory but does not persist it, so recovery requires knowing git reflog semantics.

## Goal
Make `sync.ts` both **safer** (pre-sync checkpoint on disk) and **observable** (append-only log of every sync attempt). If a sync fails, the script itself can revert. If a post-rebase regression is found later, the log tells you exactly which upstream base was applied.

## Design

### 1. Sync-state checkpoint file (non-version-controlled)

Path: `~/.omp/sync-state.json`

```json
{
  "repoPath": "/abs/path/to/repo",
  "preSyncHead": "fd6a59ca1d543a64dfae95b37832b3d1e68e68f2",
  "preSyncHeadShort": "fd6a59ca1",
  "upstreamHead": "3ec31e03a",
  "upstreamBase": "3ec31e03a",
  "startedAt": "2026-05-17T20:00:00Z",
  "status": "started",
  "syncId": "fd6a59ca1-3ec31e03a-20260517"
}
```

- Written **before** `git rebase` begins.
- `status` values: `"started"`, `"completed"`, `"failed_rebase"`, `"failed_typecheck"`, `"failed_smoke"`, `"reverted"`.
- On `--revert` flag, `sync.ts` reads this file, validates `repoPath` matches CWD, runs `git reset --hard <preSyncHead>`, updates `status` to `"reverted"`, appends log entry, and exits.
- If `sync.ts` starts and finds `status === "started"`, it warns: "Previous sync never recorded an outcome. If post-rebase fixes were made, resolve and continue. If not, run with --revert."

### 2. Sync log (append-only, non-version-controlled)

Path: `~/.omp/sync-log.jsonl`

```jsonl
{"syncId":"abc-xyz-20260101","preSyncHead":"abc","upstreamBase":"xyz","startedAt":"...","finishedAt":"...","status":"completed","newBase":"xyz","observations":[]}
{"syncId":"abc-xyz-20260101","preSyncHead":"abc","upstreamBase":"xyz","startedAt":"...","finishedAt":"...","status":"reverted","reason":"user_request"}
{"syncId":"abc-xyz-20260102","preSyncHead":"abc","upstreamBase":"xyz2","startedAt":"...","finishedAt":"...","status":"failed_typecheck","errors":["packages/ai/src/types.ts:823 parse"],"revertedAt":"..."}
```

- Each sync writes one or two lines: one for start+outcome, and optionally a second for revert.
- `observations` array captures what the agent noticed during post-rebase verification (grep results, compilation errors, symbol-presence reports).
- Logged even on failure so later analysis can see patterns ("last 3 syncs all failed at model-registry.ts argument order").

### 3. Changes to `sync.ts`

**New flags:**
- `--revert` — restore `preSyncHead`, update state+log, exit.
- `--status` — show last sync state and last 5 log entries.
- `--dry-run` — compute what would happen, write nothing.

**Pre-rebase block (insert before line 96):**
```ts
const syncState = {
  repoPath: root,
  preSyncHead: origHead,
  preSyncHeadShort: (await $`git rev-parse --short ${origHead}`).cwd(root).quiet().text().trim(),
  upstreamHead,
  upstreamBase: forkBase,
  startedAt: new Date().toISOString(),
  status: "started",
  syncId: `${origHead.slice(0,8)}-${upstreamHead}-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`,
};
await writeSyncState(syncState);
```

**Post-rebase outcome recording:**
- After rebase completes (success or conflict-failure): `status = rebase succeeded ? "rebase_ok" : "failed_rebase"`.
- After type check: `status = check passed ? "typecheck_ok" : "failed_typecheck"`.
- After smoke test: `status = smoke ok ? "completed" : "failed_smoke"`.
- Each stage appends observations (grep results, error excerpts) to `syncState.observations`.
- Final state and log entry written atomically.

**Revert path:**
```ts
if (args.includes("--revert")) {
  const state = await readSyncState();
  if (!state || state.status === "completed") {
    print("Nothing to revert (no pending sync or already completed).");
    return;
  }
  const currentHead = await $`git rev-parse HEAD`.cwd(root).quiet().text().trim();
  if (currentHead === state.preSyncHead) {
    print("Already at pre-sync HEAD.");
    return;
  }
  await $`git reset --hard ${state.preSyncHead}`.cwd(root);
  // If status wasn’t already reverted, append a new log entry
  await appendLog({ ...state, status: "reverted", finishedAt: new Date().toISOString(), reason: "cli_revert" });
  await writeSyncState({ ...state, status: "reverted" });
  print(`Reverted to ${state.preSyncHeadShort} (${state.preSyncHead}).`);
  return;
}
```

### 4. Changes to `SKILL.md`

**New section: § Automatic Rollback**
```
If the rebase introduces regressions:
1. `sync.ts` records pre-sync HEAD in `~/.omp/sync-state.json` before touching git.
2. Revert at any time: `bun .omp/skills/sync-upstream/sync.ts --revert`
3. This resets `fork/main` to the exact pre-sync commit without touching the reflog.
4. The append-only log at `~/.omp/sync-log.jsonl` records every attempt, so you can correlate
   regression patterns with specific upstream bases.
```

**Update § After Resolution checklist:**
- Add step 0: "Check `sync.ts --status` to confirm the current sync attempt is recorded."
- Replace the manual rollback section with a reference to `--revert`.

### 5. Changes to `docs/maintaining-owp-fork.md`

- Update § Sync Workflow to mention `sync.ts --revert`.
- Remove the manual `git reset --hard origin/main@{1}` snippet in favor of the automated path.
- Add a note: `~/.omp/sync-log.jsonl` is the canonical history; if you do manual git operations instead of using `sync.ts`, append a hand-rolled entry so the log stays accurate.

### 6. Changes to `feature-checklist.ts`

Optional: add a `preSync` hook that captures the current feature-checklist state (commit list, sha list) into the sync-state as `preSyncFeatures`. This lets a later analysis compare `preSyncFeatures` vs. `postSyncFeatures` to detect which commits vanished.

### 7. Edge cases

- **Multiple repos**: `sync-state.json` includes `repoPath`; running sync in a different repo creates a fresh state.
- **Interrupted sync**: `status === "started"` triggers a warning on next run. User must either `--revert` or run a fresh sync (which overwrites the state).
- **Manual git rebase**: If user runs `git rebase` by hand, `sync-state.json` won't exist. Document that `sync.ts` is the supported path; manual rebases should `git reflog`.

## Verification

1. Run `sync.ts --dry-run` → verify `~/.omp/sync-state.json` is NOT created.
2. Run `sync.ts` on a no-op rebase (already up to date) → verify state file created, status = "completed", log appended.
3. Run `sync.ts --revert` after a completed sync → verify refusal ("already completed").
4. Run `sync.ts --revert` after killing the script mid-rebase → verify reset to preSyncHead succeeds.
5. Run `sync.ts --status` → verify it reads state and prints last 5 log lines.
