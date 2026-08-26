# Plan Mode `resolve` Bug Report

## Issue

When in **plan mode**, calling `resolve` with `action: "apply"` consistently fails with:

```
No pending action to resolve. Nothing to apply or discard.
```

## Reproduction

1. Enter plan mode (system directive)
2. Write plan to `local://PLAN.md`
3. Call `resolve` with:
   - `action: "apply"`
   - `reason: "Plan is complete..."`
   - `extra: { title: "pr-preview-cleanup-cronjob" }`
4. Tool returns:
   ```
   No pending action to resolve. Nothing to apply or discard.
   ```

Attempted multiple times with identical parameters — all failed.

## Expected Behavior

`resolve` should recognize the pending plan at `local://PLAN.md` and present approval options to the user ("Approve and execute", "Approve and compact context", "Approve and keep context").

## Actual Behavior

Tool rejects the call claiming no pending action exists, despite `local://PLAN.md` being present and containing a complete plan.

## Workaround

User manually disabled plan mode and switched to normal agent mode to proceed with implementation.

## Context

- Harness: owp (oh-wiblo-pi)
- Plan file: `local://PLAN.md`
- Plan title attempted: `pr-preview-cleanup-cronjob`

## Additional User-Facing Errors

Beyond the `resolve` failure, the user observed these errors in the TUI:

### 1. `Failed: pending action — No reason provided`

After the first `resolve` failure, the agent attempted a second `resolve` call. The TUI displayed:

```
✘ Failed: pending action
No reason provided
```

This suggests `resolve` found a pending action (the previous attempt?) but rejected it because no `reason` field was provided in the second call, even though one was included in the first. The state machine for pending actions appears fragile.

### 2. `Error: The provided JSON schema contains features not supported by xgrammar.`

After the agent fell back to textual plan presentation (since `resolve` kept failing), the TUI displayed:

```
Error: The provided JSON schema contains features not supported by xgrammar.
Agent mode enabled.
```

This occurred after the plan summary text was emitted. It appears the system attempted to parse the agent's response as structured output (possibly for a plan approval schema?) but failed because the agent emitted plain text instead of a valid JSON schema. The system then auto-recovered by enabling agent mode directly, bypassing the plan approval flow entirely.

## Root Cause (Verified)

The standing resolve handler for plan mode is registered by `InteractiveMode` only (`packages/coding-agent/src/modes/interactive-mode.ts:1350`). When plan mode is entered via the interactive UI (`alt+shift+p`), the handler is set and `resolve` works. When plan mode is entered via **system directive** (harness-level activation), there is no `InteractiveMode` instance → no standing handler is registered → `ResolveTool` throws because neither `peekQueueInvoker()` nor `peekStandingResolveHandler()` returns anything.

**Key code locations:**
- `packages/coding-agent/src/tools/resolve.ts:188-190` — throws when no invoker found
- `packages/coding-agent/src/modes/interactive-mode.ts:1350` — registers handler on enter
- `packages/coding-agent/src/modes/interactive-mode.ts:1435` — clears handler on exit

This is a **design gap**: harness-level plan mode and interactive-mode plan mode have divergent resolve wiring.

## Fixes Applied

### Fix 1: Session-level standing handler registration

The plan approval resolve handler was extracted from `InteractiveMode` into `packages/coding-agent/src/plan-mode/resolve-handler.ts`.

**First applied**: 2026-06-01

**Regressed**: The wiring in `AgentSession.setPlanModeState()` that registers the standing resolve handler was lost. `createPlanApprovalResolveHandler` existed as dead code, never imported or called. Plan mode entered via system directive failed `resolve` with "No pending action to resolve".

**Restored**: 2026-06-05. `AgentSession.setPlanModeState()` now registers the standing resolve handler via `createPlanApprovalResolveHandler` whenever plan mode is activated, and clears it (`setStandingResolveHandler(null)`) when plan mode is exited. Works for both harness-level and interactive-mode entries.

**Files changed**:
- `packages/coding-agent/src/session/agent-session.ts`:
  - Import `createPlanApprovalResolveHandler` from `../plan-mode/resolve-handler`
  - `setPlanModeState`: register handler on enable, clear on disable

### Fix 2: Event-controller called wrong callback (Fixed 2026-06-01)

**Bug**: `event-controller.ts:591` called `this.ctx.handleExitPlanModeTool(planDetails)` when `resolve` returned with plan approval. This method exits plan mode **immediately without showing the approval popup**.

**Fix**: Changed to `this.ctx.handlePlanApproval(planDetails)` which shows the modal with options.

**File changed**:
- `packages/coding-agent/src/modes/controllers/event-controller.ts:591` — `handleExitPlanModeTool` → `handlePlanApproval`

### Fix 3: Missing "Save and exit" options in approval popup (Fixed 2026-06-01)

**Bug**: `handlePlanApproval` was overwritten with upstream's version during rebase, discarding the fork's "Save and exit" / "Save as new..." / overwrite-on-load features.

**Fix**: Merged fork's save options into `handlePlanApproval` alongside upstream's compact/keep context + model tier slider.

**Options now available in the approval popup**:
- "Approve and execute" — save and execute (upstream)
- "Approve and compact context" — compact then execute (upstream)
- "Approve and keep context (XX%)" — preserve context during execution (upstream)
- "Save and exit" — save to `.omp/plans/` and exit without executing (fork)
- "Save and exit (overwrite <name>)" — overwrite loaded plan and exit (fork)
- "Save as new..." — prompt for name, save, and exit (fork)
- "Refine plan" — stay in plan mode (both)

**Files changed**:
- `packages/coding-agent/src/modes/interactive-mode.ts`:
  - Added imports: `normalizePlanTitle`, `derivePlanName`, `getFinalPlanPath`, `PlanStorage`, `PlanStorageContext`
  - Modified `handlePlanApproval` to include save options in selector and their handlers

Verification:
- `bun run check:types` passes for session/plan-mode paths
- Standing resolve handler registration confirmed via code review
