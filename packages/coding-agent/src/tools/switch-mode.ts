import { type } from "@oh-my-pi/omptype";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import switchModeDescription from "../prompts/tools/switch-mode.md" with { type: "text" };
import { MODE_FROM_NAME, MODE_LABELS, modeRequestIsNoop } from "../modes/mode-state";
import type { ToolSession } from ".";

/**
 * Details returned by the `switch_mode` tool.
 *
 * `targetMode` is the mode the LLM requested. The param is designed to widen
 * to a slug string resolved against a future `ModeRegistry` without changing
 * this interface — see `docs/mode-registry-future-architecture.md`.
 */
export interface SwitchModeDetails {
	targetMode: string;
	reason?: string;
	/** The mode the harness is in after the request. */
	currentMode: string;
	/** How the request ended: switched, already there, declined, unavailable. */
	outcome: "switched" | "already" | "cancelled" | "unavailable" | "failed";
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
 * The tool performs the switch itself: it reads the *live* mode from the
 * session, skips the confirmation when the harness is already in the target
 * mode, and otherwise asks the user and applies the transition. The result
 * text is the model's only view of what happened — the status line is
 * TUI-only — so it always states the mode the harness ended up in.
 *
 * The mode is never cached here: a mode that changes outside this tool (a
 * plan approval, `/plan`, a session restore) would make the tool claim the
 * harness is somewhere it is not.
 */
export class SwitchModeTool implements AgentTool<typeof switchModeSchema, SwitchModeDetails> {
	readonly name = "switch_mode";
	readonly approval = "read" as const;
	readonly label = "Switch Mode";
	readonly summary = "Request a mode switch (e.g. exit plan/ask mode → agent)";
	readonly description = switchModeDescription;
	readonly parameters = switchModeSchema;
	readonly strict = true;

	constructor(readonly session: ToolSession) {}

	async execute(
		_toolCallId: string,
		params: SwitchModeToolInput,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<SwitchModeDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<SwitchModeDetails>> {
		const target = MODE_FROM_NAME[params.mode];
		if (target === undefined) {
			return {
				content: [{ type: "text", text: `Unknown mode: ${params.mode}.` }],
				details: { targetMode: params.mode, reason: params.reason, currentMode: "unknown", outcome: "failed" },
				isError: true,
			};
		}
		const snapshot = this.session.getModeSnapshot?.();
		const currentMode = snapshot?.mode ?? "none";
		// Already there: report it and skip the confirmation. The user is not
		// asked to re-approve a state they are in, and the model learns the
		// truth it was missing.
		if (snapshot && modeRequestIsNoop(snapshot, target)) {
			const label = MODE_LABELS[currentMode];
			return {
				content: [
					{
						type: "text",
						text: `Harness mode: ${label}. Already in ${label} mode — no switch performed.`,
					},
				],
				details: { targetMode: params.mode, reason: params.reason, currentMode, outcome: "already" },
			};
		}
		const request = this.session.requestModeSwitch;
		if (!request) {
			return {
				content: [
					{
						type: "text",
						text: `Harness mode: ${MODE_LABELS[currentMode]}. Mode switching needs an interactive session — this session cannot ask the user.`,
					},
				],
				details: { targetMode: params.mode, reason: params.reason, currentMode, outcome: "unavailable" },
				isError: true,
			};
		}
		const outcome = await request(target, params.reason);
		return {
			content: [{ type: "text", text: outcome.message }],
			details: {
				targetMode: params.mode,
				reason: params.reason,
				currentMode: outcome.mode,
				outcome: outcome.status,
			},
		};
	}
}
