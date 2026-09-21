# PLAN_LOAD_SUBCOMMAND_PLAN

Add `/plan load <name> [iteration prompt]` so users can pull a previously saved plan back into plan-mode and keep iterating. On exit, the loaded plan is silently overwritten in place — the user explicitly opted into iteration, and project plans live under version control (`.omp/plans/` is committable per the existing `plan.storage = project` setting), so a reverter exists out of band.

## Why

Today plans flow only one way:
- `/plan` → toggle plan mode (always starts a fresh `local://PLAN.md` draft).
- `/plan list` → list saved plans.
- `/plan run <name> [--keep]` → execute a saved plan (jumps straight into implementation).

There is no path to revive a saved plan **for further refinement**. After `Save and exit` (or after a `--keep` run), the only way to keep iterating is to manually copy the file. `/plan load` closes that loop, and silent overwrite-on-save makes the iterate→save cycle ergonomic.

## Behavior contract

### Loading

`/plan load <name> [iteration prompt...]`
- Resolves `<name>` exactly like `/plan run` (bare stem, absolute path, `local://` URL, or relative path with `/`) via `resolveSavedPlan` from `src/plan-mode/storage.ts`.
- No `<name>` → interactive picker (mirrors `/plan run`).
- Reads the saved plan's content.
- Writes that content into the in-progress draft path returned by `#getPlanFilePath()` (currently `local://PLAN.md`), overwriting any pre-existing draft.
- Records the source on `PlanModeState.loadedFrom` so the exit flow knows where to write back.
- Enters plan mode via `#setActiveMode("plan", { initialPrompt? })`. Because `local://PLAN.md` now exists, `plan-mode-active.md` already says "Plan file exists at `…`; you **MUST** read and update it incrementally." → no prompt-template change required.
- If `[iteration prompt]` text follows the name, pass it as `initialPrompt` so the agent's first turn focuses on the requested refinement (matches how `/plan <prompt>` already seeds an initial user message).
- If already inside plan mode → refuse with `showWarning` ("Already in plan mode. Exit first (/plan) before loading a saved plan."). This avoids silently clobbering an unsaved draft from the current session.
- Plan not found → `showError`.

### Exiting a loaded plan

When `PlanModeState.loadedFrom` is set, the exit selector gains a third save option and writes are scoped accordingly:

Selector options become:
1. `Approve and execute`
2. `Save and exit` (overwrite <name>)
3. `Save as new…`
4. `Refine plan`
5. `Stay in plan mode`

- **Approve and execute**: `finalPlanFilePath` is forced to `loadedFrom.url` (preserves project vs session storage). The agent's `exit_plan_mode` `title` argument is ignored for path resolution. Rename uses `overwrite: true`, then session clears and execution starts as today.
- **Save and exit (overwrite)**: Skips the title prompt entirely. Writes back to `loadedFrom.url` with `overwrite: true`. Status: `Plan saved to <path> (overwrote <name>). Run with: /plan run <name>`.
- **Save as new…**: Runs the existing prompt-for-title flow. Default value is `derivePlanName(latestPlanContent, existingNames)` so the suggestion reflects the *iterated* heading, not the original. The user can accept or rename. Resolves to a fresh `getFinalPlanPath(...)`; rename runs **without** `overwrite` so a typo that hits an unrelated existing plan still surfaces the existing-destination error. The original `loadedFrom` file is left untouched.
- **Refine plan** / **Stay in plan mode**: unchanged.

When `loadedFrom` is **unset** (regular plan mode), the selector keeps today's four options and `Save and exit` keeps today's prompt-for-title + dedupe flow. `Save as new…` is suppressed because it would be redundant.

## Files to modify

### 1. `packages/coding-agent/src/plan-mode/state.ts`

Add a source descriptor:
```ts
export interface PlanModeLoadedFrom {
    name: string;
    absolutePath: string;
    location: "project" | "session";
    /** Original URL form (`local://...` for session, absolute path for project). */
    url: string;
}

export interface PlanModeState {
    enabled: boolean;
    planFilePath: string;
    workflow?: "parallel" | "iterative";
    reentry?: boolean;
    loadedFrom?: PlanModeLoadedFrom;
}
```

### 2. `packages/coding-agent/src/plan-mode/approved-plan.ts`

Add `overwrite?: boolean` to `RenameApprovedPlanFileOptions`. When `overwrite` is true, skip the destination-exists pre-check (the existing `fs.rename` POSIX-replaces silently; on EXDEV the `copyFile` + `unlink` fallback also overwrites by default). On Windows, `fs.rename` will fail if the destination exists; for v1 this is acceptable since plan storage is POSIX-first, but document the limitation in a code comment if the existing file does block it. (Verify by grepping for any Windows-specific handling — none present.)

Touch points:
- `RenameApprovedPlanFileOptions` interface: add `overwrite?: boolean`.
- `renameApprovedPlanFile`: wrap the `fs.stat(resolvedDestination)` block in `if (!options.overwrite)`.

### 3. `packages/coding-agent/src/slash-commands/builtin-registry.ts`

In the `/plan` entry (around line 114-138):

- Add a `load` entry to `subcommands`:
  ```ts
  { name: "load", description: "Load a saved plan into plan mode for further iteration", usage: "<name> [iteration prompt]" },
  ```
- Extend the `handle` switch to dispatch `load` to `runtime.ctx.handlePlanLoadCommand(rest)` (mirrors `run`).

### 4. `packages/coding-agent/src/modes/types.ts`

Add to `InteractiveModeContext` next to the existing plan handlers (around line 238):
```ts
handlePlanLoadCommand(args: string): Promise<void>;
```

### 5. `packages/coding-agent/src/modes/interactive-mode.ts`

Three coordinated edits. The key simplification vs. an earlier draft is that `loadedFrom` flows as a parameter through `#setActiveMode` → `#enterPlanMode` → `setPlanModeState`, with **no** new instance field on the controller. State lives where it conceptually belongs (`PlanModeState`), and resume persistence is a one-field extension to `appendModeChange`'s existing `data` payload.

#### a. Extract a shared resolver helper

`handlePlanRunCommand` and the new `handlePlanLoadCommand` share their entire "resolve a name (or interactive picker) to a `SavedPlan`" block. Pull it into a private helper:

```ts
async #resolveSavedPlanFromArgs(
    name: string | undefined,
    pickerTitle: string,
): Promise<SavedPlan | null> {
    const ctx: PlanStorageContext = {
        cwd: this.sessionManager.getCwd(),
        getArtifactsDir: () => this.sessionManager.getArtifactsDir(),
        getSessionId: () => this.sessionManager.getSessionId(),
    };
    if (!name) {
        const plans = await listSavedPlans(ctx);
        if (plans.length === 0) {
            this.showWarning("No saved plans found.");
            return null;
        }
        const items = plans.map(p => `${p.name}  (${p.location}, ${p.mtime.toISOString()})`);
        const choice = await this.showHookSelector(pickerTitle, items);
        if (!choice) return null;
        return plans[items.indexOf(choice)] ?? null;
    }
    try {
        return await resolveSavedPlan(name, ctx);
    } catch (err) {
        this.showError(err instanceof Error ? err.message : String(err));
        return null;
    }
}
```

Refactor `handlePlanRunCommand` to use it (drop the inline picker / try-catch). Net change: small reduction in `handlePlanRunCommand`, one new helper, zero behavior change for `/plan run`.

#### b. New handler

```ts
async handlePlanLoadCommand(args: string): Promise<void> {
    if (this.planModeEnabled) {
        this.showWarning("Already in plan mode. Exit first (/plan) before loading a saved plan.");
        return;
    }
    const trimmed = args.trim();
    const spaceIdx = trimmed.indexOf(" ");
    const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const iterationPrompt = spaceIdx === -1 ? undefined : trimmed.slice(spaceIdx + 1).trim() || undefined;

    const target = await this.#resolveSavedPlanFromArgs(name || undefined, "Load saved plan");
    if (!target) {
        if (name) this.showError(`Plan not found: ${name}`);
        return;
    }

    try {
        const planContent = await Bun.file(target.absolutePath).text();
        const draftPath = await this.#getPlanFilePath(); // local://PLAN.md
        const resolvedDraft = this.#resolvePlanFilePath(draftPath);
        await Bun.write(resolvedDraft, planContent);
        this.showStatus(`Loaded plan "${target.name}" into ${draftPath}.`);
        await this.#setActiveMode("plan", {
            initialPrompt: iterationPrompt,
            loadedFrom: {
                name: target.name,
                absolutePath: target.absolutePath,
                location: target.location,
                url: target.url,
            },
        });
    } catch (err) {
        this.showError(`Failed to load plan: ${err instanceof Error ? err.message : String(err)}`);
    }
}
```

#### c. Thread `loadedFrom` through mode entry

- Extend `#setActiveMode`'s options: `{ silent?: boolean; initialPrompt?: string; loadedFrom?: PlanModeLoadedFrom }`. Pass `options?.loadedFrom` into `#enterPlanMode({ loadedFrom })`.
- Extend `#enterPlanMode`'s options: `{ planFilePath?: string; workflow?: "parallel" | "iterative"; loadedFrom?: PlanModeLoadedFrom }`. Include `loadedFrom: options?.loadedFrom` in the `setPlanModeState({...})` call.
- Extend `appendModeChange("plan", { planFilePath, loadedFrom })` so loadedFrom is persisted in session history and survives resume.
- In `#restoreModeFromSession`, read `sessionContext.modeData?.loadedFrom` and pass it to `#enterPlanMode({ planFilePath, loadedFrom })`.
- No new controller-instance field; nothing to clear on subsequent `/plan` toggles.

#### d. Short-circuit Approve and Save on loaded plans

In `handleExitPlanModeTool` (~line 1157):

```ts
const state = this.session.getPlanModeState?.();
const loadedFrom = state?.loadedFrom;

const overwriteLabel = loadedFrom ? `Save and exit (overwrite ${loadedFrom.name})` : "Save and exit";
const options = loadedFrom
    ? ["Approve and execute", overwriteLabel, "Save as new…", "Refine plan", "Stay in plan mode"]
    : ["Approve and execute", "Save and exit", "Refine plan", "Stay in plan mode"];
// existing preview render, then showHookSelector("Plan mode - next step", options, ...)

if (choice === "Approve and execute") {
    const finalPlanFilePath = loadedFrom?.url ?? (details.finalPlanFilePath || planFilePath);
    const latestPlanContent = await this.#readPlanFile(planFilePath);
    if (!latestPlanContent) { this.showError(`Plan file not found at ${planFilePath}`); return; }
    await this.#approvePlan(latestPlanContent, {
        planFilePath,
        finalPlanFilePath,
        overwrite: !!loadedFrom,
    });
    return;
}
if (loadedFrom && choice === overwriteLabel) {
    try {
        await renameApprovedPlanFile({
            planFilePath,
            finalPlanFilePath: loadedFrom.url,
            getArtifactsDir: () => this.sessionManager.getArtifactsDir(),
            getSessionId: () => this.sessionManager.getSessionId(),
            overwrite: true,
        });
    } catch (err) {
        this.showError(`Failed to save plan: ${err instanceof Error ? err.message : String(err)}`);
        return;
    }
    await this.#exitPlanMode({ silent: true, paused: false });
    this.showStatus(`Plan saved to ${loadedFrom.url} (overwrote ${loadedFrom.name}). Run with: /plan run ${loadedFrom.name}`);
    return;
}
if (choice === "Save and exit" || choice === "Save as new…") {
    // Existing prompt-for-title flow, unchanged.
    // For "Save as new…" the existing `derivePlanName(latestPlanContent, existingNames)`
    // already produces a default that reflects the iterated heading; if the agent kept the
    // original heading the suggestion will be `<original_name>_2`, which is correct because
    // the overwrite intent has its own dedicated menu entry.
    // Rename keeps `overwrite: false` so a typo into an unrelated existing plan still errors.
    // ...existing implementation...
}
```

`#approvePlan` extends to thread `overwrite`:
```ts
async #approvePlan(
    planContent: string,
    options: { planFilePath: string; finalPlanFilePath: string; overwrite?: boolean },
): Promise<void> {
    await renameApprovedPlanFile({
        planFilePath: options.planFilePath,
        finalPlanFilePath: options.finalPlanFilePath,
        getArtifactsDir: () => this.sessionManager.getArtifactsDir(),
        getSessionId: () => this.sessionManager.getSessionId(),
        overwrite: options.overwrite,
    });
    await this.#executePlan(planContent, options.finalPlanFilePath, { clearSession: true });
}
```

Note on "Approve" + session: `#executePlan` already clears the session and rewrites the plan into the new session's local-root when path is `local://`. For project paths (loaded project plans), the existing absolute-path branch leaves the file in place — correct for overwrite semantics.

### 6. `packages/coding-agent/test/slash-commands/plan-subcommands.test.ts`

Add `handlePlanLoadCommand` mock. Add tests:
- `/plan load FOO_PLAN` → `handlePlanLoadCommand("FOO_PLAN")`, others not called.
- `/plan load FOO_PLAN add an extra step` → `handlePlanLoadCommand("FOO_PLAN add an extra step")`.
- `/plan load` (no name) → `handlePlanLoadCommand("")`.

### 7. `packages/coding-agent/test/plan-mode/approved-plan.test.ts` (new)

Add focused tests for `renameApprovedPlanFile`'s overwrite contract:
- Pre-existing destination + `overwrite: true` → succeeds; destination content matches the (former) source; source path no longer exists.
- Pre-existing destination + no `overwrite` → throws "Plan destination already exists" (regression guard for current behavior).
- Cross-device fallback (`EXDEV`): mock `fs.rename` to throw `EXDEV` once → verify `copyFile` + `unlink` path runs and respects `overwrite`.

Skip a full end-to-end interactive-mode test for the Save/Approve menu branches — covered by the manual smoke. The unit tests on the rename helper are the load-bearing contract.

### 8. `packages/coding-agent/CHANGELOG.md`

Under `## [Unreleased]` → `### Added`:
```
- Added `/plan load <name>` to load a saved plan back into plan mode for continued iteration. Optionally accepts an inline iteration prompt: `/plan load FOO_PLAN tighten the rollout step`. The exit menu for a loaded plan offers `Save and exit (overwrite <name>)` for in-place save and `Save as new…` for a separate copy (default name derived from the iterated content).
```

Under `### Changed`:
```
- `renameApprovedPlanFile` now accepts `overwrite?: boolean` to support the `/plan load` save-back path; default behavior unchanged.
```

## Verification

1. `bun check:ts` — compiles cleanly.
2. `bun test packages/coding-agent/test/slash-commands/plan-subcommands.test.ts` — slash-command dispatch tests pass.
3. `bun test packages/coding-agent/test/plan-mode/approved-plan.test.ts` — overwrite-flag unit tests pass; existing destination-exists guard still triggers without the flag.
4. Manual smoke (interactive harness):
   - Save `FOO_PLAN`. In a fresh session: `/plan load FOO_PLAN tighten the rollout step` → plan mode active, draft preloaded, agent first turn addresses the iteration prompt.
   - Edit the plan, call `exit_plan_mode`, choose **Save and exit (overwrite FOO_PLAN)** → no title prompt; status confirms overwrite; on disk content reflects the edits.
   - Edit again, choose **Save as new…** → title prompt appears with a default derived from the iterated heading; accept a new name; original `FOO_PLAN` untouched; new file written.
   - Repeat, choose **Approve and execute** → session clears, new session begins with the updated plan content; `FOO_PLAN` on disk reflects the edits.
   - `/plan load NOT_REAL` → `showError` "Plan not found: NOT_REAL".
   - `/plan` (enter plan mode), then `/plan load FOO` → `showWarning` about already-active plan mode; no draft mutation.
   - Regular `/plan` (no load) followed by `Save and exit` → existing four-option menu; title prompt unchanged.
   - Resume a session that was mid-load (kill + restart `omp`): plan mode restores with `loadedFrom` intact; the overwrite menu entry still names the original plan.

## Open follow-ups (out of scope)

- Windows overwrite semantics for `fs.rename` if/when Windows becomes a target (current code is POSIX-leaning; no Windows handling exists today).


## Design choices considered and rejected

Documented so a fresh session does not re-litigate them.

- **Don't track `loadedFrom`; let the agent re-derive a title.** Rejected: agent-suggested title would dedupe to `<name>_2`, and `renameApprovedPlanFile` hard-throws on existing destination. Result: the user has to manually delete the original to overwrite, defeating the iteration loop.
- **Generalize "overwrite-on-conflict" prompt for *all* saves instead of `loadedFrom`.** Rejected: modifies the load-bearing default Save flow in service of a new feature; less surgical than a feature-scoped state field.
- **Encode `loadedFrom` in plan-file frontmatter.** Rejected: the agent freely rewrites the plan file (`Bun.write` from `edit`/`write` tools), so the marker is not durable; also adds parsing.
- **Instance field on `InteractiveMode` instead of `PlanModeState`.** Rejected: `loadedFrom` is conceptually plan-state, and field-on-controller does not survive resume. Threading through `#setActiveMode` keeps the controller clean.
- **"Save as new…" for non-loaded plans.** Suppressed: would be redundant (the regular `Save and exit` already prompts for a name).
- **`--clear` flag on `/plan load`.** Skipped for v1: matches `/plan` (which never clears). The whole point of load is to keep the in-flight session context.