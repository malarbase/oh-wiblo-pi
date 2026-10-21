import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";
import type { ToolSession } from "../../tools";
import { isReadOnlyBashCommand } from "./bash-readonly";
import { isReadOnlyTool } from "./readonly-tools";
import type { AskModeValidator } from "./tool-guard";

/**
 * Block message returned to the LLM when a tool call is refused in Ask mode.
 * Names the `switch_mode` tool so the model can autonomously request a mode
 * transition instead of dead-ending on a refusal.
 */
const ASK_MODE_BLOCKED_PREFIX = "Cannot use";

function blockResult(toolName: string, reason: string): AgentToolResult {
	return {
		content: [
			{
				type: "text",
				text: `${ASK_MODE_BLOCKED_PREFIX} ${toolName} in Ask mode: ${reason}. Call switch_mode("agent") to request a mode switch, then retry.`,
			},
		],
	};
}

/** Pull the `command` field out of bash params (missing → "", fail-closed). */
function bashCommandOf(params: unknown): string {
	return typeof params === "object" && params !== null && "command" in params
		? String((params as Record<string, unknown>).command)
		: "";
}

const denyMutation: AskModeValidator = () => ({ allowed: false, reason: "mutation detected" });
const allowReadOnly: AskModeValidator = () => ({ allowed: true });

/**
 * Per-tool Ask-mode validators consumed by `wrapToolWithAskModeGuard`
 * (`tool-guard.ts`), which `createTools` applies once to every tool it
 * materializes. The wrapper consults this map for every tool outside the
 * static `READ_ONLY_TOOLS` set, so ask-mode policy lives here in one place:
 *
 *  - `bash`: delegated to `isReadOnlyBashCommand(params.command)`
 *    (allowlist-first, fail-closed) — read-only commands run, mutating ones
 *    are blocked with the classifier's reason.
 *  - mutating built-ins: refused by name with `mutation detected`, the same
 *    text `enforceAskModeGuard` produces for its in-tool callers
 *    (checkpoint, rewind, the mimo edit mode), so wrapper and in-tool guard
 *    return identical refusals.
 *  - the escape hatch `switch_mode` — every block message tells the model to
 *    call it — plus tools that stay callable without breaking the read-only
 *    contract (`glob`, `todo`, `think`, `ask_followup_question`, `yield`).
 *  - any tool without an entry (including future built-ins): the wrapper
 *    fails closed with its generic block message.
 */
export const ASK_MODE_VALIDATORS: Record<string, AskModeValidator> = {
	bash: params => isReadOnlyBashCommand(bashCommandOf(params)),
	write: denyMutation,
	edit: denyMutation,
	ast_edit: denyMutation,
	checkpoint: denyMutation,
	rewind: denyMutation,
	switch_mode: allowReadOnly,
	glob: allowReadOnly,
	todo: allowReadOnly,
	think: allowReadOnly,
	ask_followup_question: allowReadOnly,
	yield: allowReadOnly,
};

/**
 * In-tool Ask-mode guard. Returns a block result (mentioning `switch_mode`)
 * if the call is disallowed, or `null` if the call may proceed.
 *
 * Mirrors the `plan-mode-guard.ts` pattern: called from within a tool's
 * `execute()` method via `session.getAskModeState?.()`. This is rebase-safe
 * because the guard lives in its own file (not the heavily-rebased
 * `agent-session.ts`), and each tool's call site is a single line.
 *
 * Classification shares `ASK_MODE_VALIDATORS` with the `createTools`
 * wrapper, so both paths enforce one policy:
 *  - tools in the static `READ_ONLY_TOOLS` set (read, grep, find, lsp, …): always allowed.
 *  - otherwise the tool's validator decides (`bash` → `isReadOnlyBashCommand`).
 *  - no validator: blocked as a non-readonly mutation.
 */
export function enforceAskModeGuard(session: ToolSession, toolName: string, params: unknown): AgentToolResult | null {
	const state = session.getAskModeState?.();
	if (!state?.enabled) return null;

	// Static readonly allowlist covers read/grep/find/lsp/ask/…
	if (isReadOnlyTool(toolName)) return null;

	const validator = ASK_MODE_VALIDATORS[toolName];
	const check = validator ? validator(params) : { allowed: false, reason: "mutation detected" };
	if (check.allowed) return null;
	return blockResult(toolName, check.reason ?? "mutation detected");
}
