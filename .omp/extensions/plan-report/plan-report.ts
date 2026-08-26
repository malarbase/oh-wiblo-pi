import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/** Resolve a '/var/home/user/.omp/agent/sessions/home-Work-f17ce407f776c96b4c54523e5b630137a49fcd033539cf91e927aa5e4d16a5ea/2026-08-04T20-09-02-293Z_019fce64-d455-7000-afe7-b7fb7843d779/local' URL to a filesystem path using the session's artifacts dir.
 *  local:// files live in the `local/` subdirectory of the artifacts root. */
function resolveLocalPath(localUrl: string, artifactsDir: string): string {
	const relativePath = localUrl.replace(/^local:\/+/, "");
	return path.resolve(artifactsDir, "local", relativePath);
}

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async (_event, ctx) => {
		// Skip if more messages are queued — wait for the real end of the sequence.
		if (ctx.hasPendingMessages()) return;

		// Search the FULL session history (not just _event.messages which only
		// contains the current agent loop's messages). The plan approval message
		// is typically in the first prompt, but agent_end only carries new messages.
		const entries = ctx.sessionManager.getEntries();
		const planInfo = detectPlanCompletion(entries);
		if (!planInfo) return;

		// Resolve plan path — check project storage first, then session '/var/home/user/.omp/agent/sessions/home-Work-f17ce407f776c96b4c54523e5b630137a49fcd033539cf91e927aa5e4d16a5ea/2026-08-04T20-09-02-293Z_019fce64-d455-7000-afe7-b7fb7843d779/local'
		const artifactsDir = ctx.sessionManager.getArtifactsDir();
		const cwd = ctx.sessionManager.getCwd?.() ?? process.cwd();
		const fileName = planInfo.planPath.split("/").pop() || "plan.md";

		// Project storage: .omp/plans/<fileName> — always use this for done/report
		const projectPlanPath = path.resolve(cwd, ".omp", "plans", fileName);
		const projectDonePath = path.resolve(cwd, ".omp", "plans", fileName.replace(/\.md$/, ".done.md"));
		const projectReportPath = path.resolve(cwd, ".omp", "plans", fileName.replace(/\.md$/, ".report.md"));

		// Session storage: '/var/home/user/.omp/agent/sessions/home-Work-f17ce407f776c96b4c54523e5b630137a49fcd033539cf91e927aa5e4d16a5ea/2026-08-04T20-09-02-293Z_019fce64-d455-7000-afe7-b7fb7843d779/local/<fileName>'
		const sessionPlanPath = artifactsDir ? resolveLocalPath(planInfo.planPath, artifactsDir) : null;

		// Idempotency guard: skip if the .done.md already exists (plan was already processed)
		if (await Bun.file(projectDonePath).exists().catch(() => false)) return;

		// Find the actual plan file — project first, then session
		let resolvedPlanPath: string | null = null;

		try {
			await Bun.file(projectPlanPath).text();
			resolvedPlanPath = projectPlanPath;
		} catch {
			// Not in project — try session
			if (sessionPlanPath) {
				try {
					await Bun.file(sessionPlanPath).text();
					resolvedPlanPath = sessionPlanPath;
				} catch {
					// Plan file not found anywhere — skip
					return;
				}
			} else {
				return;
			}
		}

		// Rename plan file to .done.md to mark as completed (always in project dir)
		try {
			await Bun.write(projectDonePath, await Bun.file(resolvedPlanPath).text());
			await fs.unlink(resolvedPlanPath);
		} catch (err) {
			if (!(err instanceof Error && err.message.includes("ENOENT"))) {
				console.error("[plan-report] Failed to rename plan:", err);
			}
		}

		// Trigger LLM to generate the report and write it to project .omp/plans/
		// Always use project paths — the LLM's write tool resolves filesystem paths directly.
		await pi.sendUserMessage(
			`[SYSTEM - plan-report extension]: Implementation of plan "${planInfo.title}" has completed. Plan renamed to \`${projectDonePath}\`.

Please generate a comprehensive implementation report and write it to \`${projectReportPath}\`.

The report should include:
1. A brief summary of what was implemented (2-4 sentences)
2. Key changes made (files modified, commands executed)
3. Any notable decisions or trade-offs

Write the report to the file now.`,
			{ deliverAs: "followUp" },
		);
	});
}

type SessionEntry = { type: string; message?: { role: string; content?: unknown } };

function detectPlanCompletion(entries: SessionEntry[]) {
	// Extract full text from a message (handles both string and array content)
	function getMessageText(content: unknown): string {
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.filter((c): c is { type: "text"; text: string } => typeof c === "object" && c !== null && c.type === "text" && typeof c.text === "string")
				.map((c) => c.text)
				.join("\n");
		}
		return "";
	}

	// Search session entries for the plan approval message.
	// Can be role "user" or "developer" (system directives from the harness).
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (!msg) continue;
		if (msg.role !== "user" && msg.role !== "developer") continue;
		const text = getMessageText(msg.content);

		// Match the stable "Plan approved." prefix — this is the one string
		// that has been consistent across prompt template versions.
		if (!text.includes("Plan approved.")) continue;

		// Extract the plan file path from the instruction block.
		// The prompt template renders as: You MUST read `<path>` before executing.
		// This pattern is stable across versions — the path is the only variable.
		const pathMatch = /You MUST read `(.+?)` before executing/.exec(text);
		if (!pathMatch) continue;

		const planPath = pathMatch[1];
		const fileName = planPath.split("/").pop() || "plan.md";
		const title = fileName.replace(/\.md$/, "").replace(/-/g, " ");

		return { planPath, title };
	}

	return null;
}
