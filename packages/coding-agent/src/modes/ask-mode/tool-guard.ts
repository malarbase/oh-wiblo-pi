import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Static, TSchema } from "@oh-my-pi/pi-ai";
import type { AskModeState } from "./state";
import { isReadOnlyTool } from "./readonly-tools";

const ASK_MODE_BLOCKED_MESSAGE =
	"Cannot use write tools in Ask mode. Switch to Agent mode to make changes.";

/**
 * Wraps a tool's execute method with an Ask-mode guard that rejects
 * non-readonly tool calls when Ask mode is active. The guard checks
 * the live state accessor on every call so toggling Ask mode on/off
 * takes effect immediately without rewrapping.
 */
export function wrapToolWithAskModeGuard<T extends AgentTool<any, any, any>>(
	tool: T,
	getAskModeState: () => AskModeState | undefined,
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
			return {
				content: [{ type: "text", text: ASK_MODE_BLOCKED_MESSAGE }],
			};
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
