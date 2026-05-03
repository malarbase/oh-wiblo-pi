import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Static, TSchema } from "@oh-my-pi/pi-ai";
import type { ReadOnlyCheck } from "./bash-readonly";
import { isReadOnlyTool } from "./readonly-tools";
import type { AskModeState } from "./state";

const ASK_MODE_BLOCKED_MESSAGE = "Cannot use write tools in Ask mode. Switch to Agent mode to make changes.";

/**
 * A per-tool validator called in ask mode when the tool is not in the
 * static read-only set.  Returns `{ allowed: true }` to proceed or
 * `{ allowed: false, reason }` to block with a descriptive message.
 */
export type AskModeValidator = (params: unknown) => ReadOnlyCheck;

/**
 * Wraps a tool's execute method with an Ask-mode guard that rejects
 * non-readonly tool calls when Ask mode is active. The guard checks
 * the live state accessor on every call so toggling Ask mode on/off
 * takes effect immediately without rewrapping.
 *
 * @param validators  Optional per-tool validators for tools that are not in
 *                    the static read-only set but may still be permitted after
 *                    runtime inspection of the call parameters (e.g. bash with
 *                    a read-only command).
 */
export function wrapToolWithAskModeGuard<T extends AgentTool<any, any, any>>(
	tool: T,
	getAskModeState: () => AskModeState | undefined,
	validators?: Map<string, AskModeValidator>,
): T {
	const originalExecute = tool.execute;

	const guardedExecute: AgentTool["execute"] = async function (
		this: AgentTool<TSchema, unknown>,
		toolCallId: string,
		params: Static<TSchema>,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<unknown, TSchema>,
		context?: AgentToolContext,
	): Promise<AgentToolResult> {
		const state = getAskModeState();
		if (state?.enabled && !isReadOnlyTool(tool.name)) {
			const validator = validators?.get(tool.name);
			if (validator) {
				const check = validator(params);
				if (!check.allowed) {
					const reason = check.reason ?? "mutation detected";
					return {
						content: [
							{
								type: "text",
								text: `Cannot use ${tool.name} in Ask mode: ${reason}. Switch to Agent mode to make changes.`,
							},
						],
					};
				}
			} else {
				return {
					content: [{ type: "text", text: ASK_MODE_BLOCKED_MESSAGE }],
				};
			}
		}
		return originalExecute.call(this, toolCallId, params, signal, onUpdate, context);
	};

	return Object.defineProperty(tool, "execute", {
		value: guardedExecute,
		enumerable: false,
		configurable: true,
		writable: true,
	}) as T;
}
