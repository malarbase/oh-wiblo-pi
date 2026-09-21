Request a mode switch. The user must approve the switch before it takes effect.

# When to call

Call this tool when one of the following is true:

- You are in **Ask mode** or **Plan mode** and need to make changes (write files, run mutating bash commands, etc.). Call with `mode="agent"` and a short reason explaining what change you intend to make. After the user approves the switch, retry your intended action.
- You are in **Plan mode** and want to exit without approving the plan (e.g. the user redirected you, or you discovered the plan isn't needed). Call with `mode="agent"` and a reason. This is the plain-exit path — it does NOT approve or execute a plan. If you want to approve and execute a plan you wrote, use `resolve({ action: "apply" })` instead.
- The conversation would benefit from a different mode. For example, if the user's task is exploratory or read-only, suggest switching to **Ask mode**. If it requires a structured plan, suggest **Plan mode**. Call with the appropriate `mode` and explain why.

# Modes

- `"agent"` — Normal agent mode with full tool access.
- `"ask"` — Read-only mode. Cannot write files or run mutating commands.
- `"plan"` — Planning mode. Draft and refine a plan before execution.
- `"debug"` — Debug mode. Focused troubleshooting with extra diagnostics.
- `"goal"` — Goal mode. Work toward a tracked objective with budget constraints.

# Parameters

- `mode` — target mode to switch to.
- `reason` — optional short reason for the switch. Shown to the user in the approval prompt.

# After the call

The user is shown a confirmation prompt. If approved, the mode switches and you should adapt to the new mode's behavior. If rejected, stay in the current mode and adapt — do not re-issue `switch_mode` with the same arguments in a loop.
