import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";
import type { ToolSession } from "../../tools";
import { isReadOnlyBashCommand } from "./bash-readonly";
import { isReadOnlyTool } from "./readonly-tools";

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

/**
 * In-tool Ask-mode guard. Returns a block result (mentioning `switch_mode`)
 * if the call is disallowed, or `null` if the call may proceed.
 *
 * Mirrors the `plan-mode-guard.ts` pattern: called from within a tool's
 * `execute()` method via `session.getAskModeState?.()`. This is rebase-safe
 * because the guard lives in its own file (not the heavily-rebased
 * `agent-session.ts`), and each tool's call site is a single line.
 *
 * Classification rules:
 *  - `bash`: delegated to `isReadOnlyBashCommand(params.command)` (allowlist-first, fail-closed).
 *  - tools in the static `READ_ONLY_TOOLS` set (read, grep, find, lsp, …): always allowed.
 *  - any other tool: blocked as a non-readonly mutation.
 */
export function enforceAskModeGuard(session: ToolSession, toolName: string, params: unknown): AgentToolResult | null {
	const state = session.getAskModeState?.();
	if (!state?.enabled) return null;

	// Static readonly allowlist covers read/grep/find/lsp/ask/…
	if (isReadOnlyTool(toolName)) return null;

	if (toolName === "bash") {
		const command =
			typeof params === "object" && params !== null && "command" in params
				? String((params as Record<string, unknown>).command)
				: "";
		const check = isReadOnlyBashCommand(command);
		if (check.allowed) return null;
		return blockResult(toolName, check.reason ?? "mutation detected");
	}

	return blockResult(toolName, "mutation detected");
}
