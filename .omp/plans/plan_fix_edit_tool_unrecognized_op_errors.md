# Plan: Hashline Parser Payload Recovery + Plan-Mode Overwrite Bug

## Task 1: Hashline Parser Payload Recovery (PRIMARY)

### Problem Summary
The `edit` tool (hashline mode parser) throws `unrecognized op` errors when the model forgets the `~` payload prefix on content lines. This is the single most common edit failure across all sessions.

### Root Cause
`collectPayload()` in `packages/coding-agent/src/hashline/parser.ts` stops at the first non-blank, non-`~` line and returns. The main loop then hits that line, fails to match it against op regexes, and throws `unrecognized op`.

### Root Cause Classification: Model Issue, Not Prompt Issue
The prompt already says "Every payload line MUST start with `~`" three times with clear RIGHT/WRONG examples. The failures are a structural attention reset during multi-line code block generation, not an instruction-comprehension gap.

### Fix Design
After the blank-line recovery block in `collectPayload()`, add an orphaned payload recovery branch using a character-based check (not regex).

```typescript
const opChar = line[0];
if (
    line.trim().length > 0 &&
    line !== END_PATCH_MARKER &&
    line !== ABORT_MARKER &&
    opChar !== "<" &&
    opChar !== "+" &&
    opChar !== "-" &&
    opChar !== "="
) {
    payload.push(line);
    index++;
    continue;
}
```

### Upstream Check
`upstream/main` has the exact same `collectPayload()` implementation. Fix applies directly.

### Side Effects
- Cannot recover content starting with `<`, `+`, `-`, `=` (e.g. JSX `<div>`).
- No warning emitted on recovery — deferred to follow-up.

### Files to Modify
| File | Change |
|---|---|
| `packages/coding-agent/src/hashline/parser.ts` | Add orphaned payload recovery in `collectPayload()` |

### Verification
1. Add unit test in `packages/coding-agent/test/core/hashline.test.ts` for missing `~` prefixes.
2. Run `bun test test/core/hashline.test.ts` — no regressions.
3. Run `bun check` in `packages/coding-agent` — clean.

---

## Task 2: Plan-Mode Overwrite Bug (SECONDARY)

### Problem Summary
When calling `resolve` with `action: "apply"` and a `title` that matches an existing plan file in `.omp/plans/`, the system throws:
```
Error: Failed to finalize approved plan: Plan destination already exists at ...
```

### Root Cause Found
In `packages/coding-agent/src/modes/interactive-mode.ts`, method `#approvePlan()` (line 1812) calls `renameApprovedPlanFile()` without passing `overwrite: true`. The `renameApprovedPlanFile` function in `packages/coding-agent/src/plan-mode/approved-plan.ts` defaults `overwrite` to falsy, so when the destination file exists it throws instead of overwriting.

The same issue exists in the `/plan save` path at line 2079.

### Fix Design
1. `#approvePlan` path (line ~1812): pass `overwrite: true`. User approval is the signal to proceed — stale files should never block execution.
2. `/plan save` path (line ~2079): pass `overwrite: true`. When a user explicitly names a save target, they intend to clobber any existing plan with that name.

```typescript
await renameApprovedPlanFile({
    planFilePath: options.planFilePath,
    finalPlanFilePath: options.finalPlanFilePath,
    getArtifactsDir: () => this.sessionManager.getArtifactsDir(),
    getSessionId: () => this.sessionManager.getSessionId(),
    overwrite: true,  // ADD THIS
});
```

### Files to Modify
| File | Change |
|---|---|
| `packages/coding-agent/src/modes/interactive-mode.ts` | Add `overwrite: true` to `renameApprovedPlanFile` calls at ~line 1812 and ~line 2079 |

### Verification
1. Run `bun check` in `packages/coding-agent` — clean.
2. Manual: create a plan with title `foo`, approve it, create another plan with same title `foo`, approve it again — should succeed and overwrite, not throw.
