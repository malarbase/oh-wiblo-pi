import { type } from "@oh-my-pi/omptype";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { TERMINAL } from "@oh-my-pi/pi-tui";
import { prompt, untilAborted } from "@oh-my-pi/pi-utils";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { ExtensionUISelectItem } from "../extensibility/extensions";
import type { Theme } from "../modes/theme/theme";
import askFollowupDescription from "../prompts/tools/ask-followup-question.md" with { type: "text" };
import { renderStatusLine } from "../tui";
import type { ToolSession } from ".";
import { truncateToWidth } from "./render-utils";
import { ToolAbortError } from "./tool-errors";

// =============================================================================
// Types
// =============================================================================

const FollowUpItem = type({
	text: type("string").describe("pre-filled prompt text the user will send"),
	"mode?": type("'agent' | 'ask' | 'plan' | 'debug' | 'goal'").describe("mode to switch to before sending the prompt"),
});

const askFollowupSchema = type({
	question: type("string").describe("short label shown above the suggestions"),
	follow_up: FollowUpItem.array().atLeastLength(1).describe("suggestions for the user to select from"),
});

type AskFollowupParams = typeof askFollowupSchema.infer;

export interface AskFollowupDetails {
	question?: string;
	selectedText?: string;
	selectedMode?: string;
	reason?: string;
}

const OTHER_OPTION = "Other (type your own)";

// =============================================================================
// Tool Class
// =============================================================================

/**
 * Ask follow-up question tool. Presents the user with pre-filled prompt
 * options they can select from, with optional mode switch per suggestion.
 *
 * Like Zoo-Code's ask_followup_question, this allows the agent to guide
 * the conversation by suggesting next steps. Each suggestion can optionally
 * trigger a mode switch before the prompt is sent.
 */
export class AskFollowupQuestionTool implements AgentTool<typeof askFollowupSchema, AskFollowupDetails> {
	readonly name = "ask_followup_question";
	readonly approval = "read" as const;
	readonly label = "Follow-up";
	readonly summary = "Suggest follow-up prompts with optional mode switch";
	readonly description: string;
	readonly parameters = askFollowupSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";

	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(askFollowupDescription);
	}

	/** Send terminal notification when waiting for input */
	#sendNotification(): void {
		const method = this.session.settings.get("ask.notify");
		if (method === "off") return;
		TERMINAL.sendNotification("Select a follow-up");
	}

	async execute(
		_toolCallId: string,
		params: AskFollowupParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<AskFollowupDetails>,
		context?: AgentToolContext,
	): Promise<AgentToolResult<AskFollowupDetails>> {
		// Headless fallback
		if (!context?.hasUI || !context.ui) {
			context?.abort();
			throw new ToolAbortError("ask_followup_question requires interactive mode");
		}

		const extensionUi = context.ui;
		this.#sendNotification();

		// Build display options with mode badges
		const options: ExtensionUISelectItem[] = params.follow_up.map(item => {
			const modeLabel = item.mode ? ` [${item.mode}]` : "";
			const label = `${item.text}${modeLabel}`;
			return item.mode ? { label, description: `Switch to ${item.mode} mode` } : label;
		});
		options.push(OTHER_OPTION);

		// Show selection dialog
		const selectPrompt = params.question;
		let selection: string | undefined;
		try {
			selection = signal
				? await untilAborted(signal, () => extensionUi.select(selectPrompt, options, { outline: true }))
				: await extensionUi.select(selectPrompt, options, { outline: true });
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new ToolAbortError("Follow-up selection was cancelled");
			}
			throw error;
		}

		if (selection === undefined || selection === OTHER_OPTION) {
			// User cancelled or chose "Other" — let them type free-form
			if (selection === OTHER_OPTION) {
				const customInput = signal
					? await untilAborted(signal, () =>
							extensionUi.editor("Enter your follow-up:", undefined, undefined, { promptStyle: true }),
						)
					: await extensionUi.editor("Enter your follow-up:", undefined, undefined, { promptStyle: true });
				if (customInput !== undefined) {
					return {
						content: [{ type: "text", text: customInput }],
						details: { question: params.question, selectedText: customInput },
					};
				}
			}
			// User cancelled
			context.abort();
			throw new ToolAbortError("Follow-up selection was cancelled");
		}

		// Find the matching follow-up item
		const selectedItem = params.follow_up.find(item => {
			const modeLabel = item.mode ? ` [${item.mode}]` : "";
			return `${item.text}${modeLabel}` === selection || item.text === selection;
		});

		if (!selectedItem) {
			// Fallback: treat selection as the text
			return {
				content: [{ type: "text", text: selection }],
				details: { question: params.question, selectedText: selection },
			};
		}

		const details: AskFollowupDetails = {
			question: params.question,
			selectedText: selectedItem.text,
			selectedMode: selectedItem.mode,
		};

		// If a mode was specified, include it in details for event-controller to react
		if (selectedItem.mode) {
			details.reason = `User selected follow-up: ${selectedItem.text}`;
		}

		return {
			content: [{ type: "text", text: selectedItem.text }],
			details,
		};
	}
}

// =============================================================================
// TUI Renderer
// =============================================================================

interface AskFollowupRenderArgs {
	question?: string;
	follow_up?: Array<{ text: string; mode?: string }>;
}

export const askFollowupQuestionRenderer = {
	renderCall(args: AskFollowupRenderArgs, _options: RenderResultOptions, uiTheme: Theme) {
		const question = args.question ?? "Follow-up";
		const count = args.follow_up?.length ?? 0;
		const text = renderStatusLine(
			{
				icon: "pending",
				title: "Follow-up",
				description: truncateToWidth(question, 60),
				badge: { label: `${count} suggestion${count !== 1 ? "s" : ""}`, color: "accent" as const },
			},
			uiTheme,
		);
		return { render: () => text, invalidate() {} };
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: AskFollowupDetails; isError?: boolean },
		_options: RenderResultOptions,
		uiTheme: Theme,
	) {
		const details = result.details;
		const selectedText = details?.selectedText ?? "cancelled";
		const modeBadge = details?.selectedMode ? ` → ${details.selectedMode}` : "";
		const isError = result.isError;
		const icon = isError ? uiTheme.status.error : uiTheme.status.success;
		const text = `${icon} Selected: ${truncateToWidth(selectedText, 60)}${modeBadge}`;

		return {
			render: () => text,
			invalidate() {},
		};
	},

	inline: true,
	mergeCallAndResult: true,
};
