import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

interface PendingWrite {
	path: string;
	content: string;
}

const MUTATING_TOOLS: Record<string, true> = {
	write: true,
	edit: true,
	ast_edit: true,
	task: true,
	generate_image: true,
};

export default function (pi: ExtensionAPI) {
	const pendingWrites: PendingWrite[] = [];
	let wasAskMode = false;

	pi.on("tool_call", (event, ctx) => {
		const isAskMode = ctx
			.getSystemPrompt()
			.some((s) => s.includes("Ask mode is active."));

		// Flush pending writes when transitioning from Ask → Agent
		if (wasAskMode && !isAskMode && pendingWrites.length > 0) {
			for (const write of pendingWrites) {
				try {
					Bun.write(write.path, write.content);
				} catch (err) {
					console.error(`[ask-mode-guard] Failed to flush deferred write: ${write.path}`, err);
				}
			}
			pendingWrites.length = 0;
		}
		wasAskMode = isAskMode;

		if (!isAskMode) return;

		if (event.toolName === "write" && event.input.path && event.input.content) {
			// Defer write — save content for replay after mode switch
			pendingWrites.push({
				path: event.input.path,
				content: event.input.content,
			});
			return {
				block: true,
				reason:
					`"write" is deferred in Ask mode — content will be written automatically ` +
					`after switching to agent mode. Call switch_mode to proceed.`,
			};
		}

		if (event.toolName in MUTATING_TOOLS) {
			return {
				block: true,
				reason:
					`"${event.toolName}" is blocked in Ask mode — it performs mutations. ` +
					`Call switch_mode to "agent" first to make changes.`,
			};
		}
	});
}