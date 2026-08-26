import { type } from "@oh-my-pi/omptype";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import switchModeDescription from "../prompts/tools/switch-mode.md" with { type: "text" };
import type { ToolSession } from ".";

/**
 * Details returned by the `switch_mode` tool. The event-controller reacts to
 * a completed `switch_mode` call by invoking
 * `ctx.handleSwitchModeTool(details)`,
 * mirroring the pre-existing `exit_plan_mode` reaction pattern.
 *
 * `targetMode` is the mode the LLM requested (currently "agent" or "ask").
 * The param is designed to widen to a slug string resolved against a future
 * `ModeRegistry` without changing this interface — see
 * `docs/mode-registry-future-architecture.md`.
 */
export interface SwitchModeDetails {
	targetMode: string;
	reason?: string;
}

const switchModeSchema = type({
	mode: type("'agent' | 'ask' | 'plan' | 'debug' | 'goal'").describe("target mode to switch to"),
	"reason?": type("string").describe("optional reason for the mode switch"),
});

type SwitchModeToolInput = typeof switchModeSchema.infer;

/**
 * LLM-driven mode switch. Generalizes the pre-existing `exit_plan_mode` tool:
 * plan-mode's "exit without approving" path and ask-mode's "I need to make
 * changes" path both route through this tool.
 *
 * The tool itself does NOT mutate mode state — it returns `details` and lets
 * `event-controller.ts` react post-execution by calling
 * `ctx.handleSwitchModeTool(details)`, which shows the user a confirmation
 * prompt and, on approval, toggles mode via the existing mode-command handlers.
 *
 * Plan mode's `resolve`/`plan_approval` "approve and execute" flow is
 * untouched — `switch_mode` only subsumes the plain-exit path.
 */
export class SwitchModeTool implements AgentTool<typeof switchModeSchema, SwitchModeDetails> {
	readonly name = "switch_mode";
	readonly approval = "read" as const;
	readonly label = "Switch Mode";
	readonly summary = "Request a mode switch (e.g. exit plan/ask mode → agent)";
	readonly description = switchModeDescription;
	readonly parameters = switchModeSchema;
	readonly strict = true;

	constructor(readonly _session: ToolSession) {}

	async execute(
		_toolCallId: string,
		params: SwitchModeToolInput,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<SwitchModeDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<SwitchModeDetails>> {
		const details: SwitchModeDetails = { targetMode: params.mode, reason: params.reason };
		return {
			content: [
				{
					type: "text",
					text: params.reason
						? `Requested switch to ${params.mode} mode: ${params.reason}`
						: `Requested switch to ${params.mode} mode.`,
				},
			],
			details,
		};
	}
}
