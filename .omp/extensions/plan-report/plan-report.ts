import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/** Resolve a 'local://…' URL to a filesystem path using the session's artifacts dir.
 *  local:// files live in the `local/` subdirectory of the artifacts root. */
function resolveLocalPath(localUrl: string, artifactsDir: string): string {
	const relativePath = localUrl.replace(/^local:\/+/, "");
	return path.resolve(artifactsDir, "local", relativePath);
}

/** Extract full text from a message content (handles both string and array content). */
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

type SessionEntry = { type: string; message?: { role: string; content?: unknown } };

/** Search session entries for the plan approval message and return plan metadata. */
function detectPlanCompletion(entries: SessionEntry[]) {
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (!msg) continue;
		if (msg.role !== "user" && msg.role !== "developer") continue;
		const text = getMessageText(msg.content);

		if (!text.includes("Plan approved.")) continue;

		// The approved-plan prompt has been rewritten twice in this fork. Anchors, most
		// stable first: the <plan path="…"> attribute (machine-readable, present since the
		// plan-inlining commit), the "durable copy at" prose marker from the same
		// template, then the pre-inline "MUST read … before execution" wording so older
		// transcripts still resolve.
		const pathMatch =
			/<plan path="(.+?)">/.exec(text) ??
			/durable copy at `(.+?)`/.exec(text) ??
			/(?:You )?MUST read `(.+?)` before execut/.exec(text);
		if (!pathMatch) continue;

		const planPath = pathMatch[1];
		const fileName = planPath.split("/").pop() || "plan.md";
		const title = fileName.replace(/\.md$/, "").replace(/-/g, " ");

		return { planPath, title };
	}

	return null;
}

/** Check if the todo tool has signaled all tasks complete.
 *  The todo tool outputs "Remaining items: none." when every task is done (todo.ts:744).
 *  Returns false for plans that don't use the todo tool — no false positives. */
function isPlanExecutionComplete(entries: SessionEntry[]): boolean {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (!msg || msg.role !== "toolResult") continue;
		const text = getMessageText(msg.content);
		if (text.includes("Remaining items: none.")) return true;
		if (/Overall: (\d+)\/\1 done, 0 open/.test(text)) return true;
	}
	return false;
}

/** Shared plan-detection, idempotency check, rename, and report-trigger logic.
 *  Used by both agent_end (fast path) and session_stop (fallback).
 *  Returns true if a report was triggered. */
async function processPlanCompletion(
	pi: ExtensionAPI,
	cwd: string,
	artifactsDir: string | null | undefined,
	entries: SessionEntry[],
): Promise<boolean> {
	const planInfo = detectPlanCompletion(entries);
	if (!planInfo) return false;

	const fileName = planInfo.planPath.split("/").pop() || "plan.md";

	// Project storage: .omp/plans/<fileName> — always use this for done/report
	const plansDir = path.resolve(cwd, ".omp", "plans");
	const projectPlanPath = path.resolve(plansDir, fileName);
	const projectDonePath = path.resolve(plansDir, "done", fileName.replace(/\.md$/, ".done.md"));
	const projectReportPath = path.resolve(plansDir, "reports", fileName.replace(/\.md$/, ".report.md"));

	await fs.mkdir(path.resolve(plansDir, "done"), { recursive: true });
	await fs.mkdir(path.resolve(plansDir, "reports"), { recursive: true });

	// Idempotency guard: skip if the .done.md already exists (plan was already processed)
	if (await Bun.file(projectDonePath).exists().catch(() => false)) return false;

	// Session storage: local://<fileName>
	const sessionPlanPath = artifactsDir ? resolveLocalPath(planInfo.planPath, artifactsDir) : null;

	// Find the actual plan file — project first, then session
	let resolvedPlanPath: string | null = null;

	try {
		await Bun.file(projectPlanPath).text();
		resolvedPlanPath = projectPlanPath;
	} catch {
		if (sessionPlanPath) {
			try {
				await Bun.file(sessionPlanPath).text();
				resolvedPlanPath = sessionPlanPath;
			} catch {
				// Plan file not found anywhere — skip
				return false;
			}
		} else {
			return false;
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

	// Trigger LLM to generate report and write it to project .omp/plans/reports/
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
	return true;
}

export default function (pi: ExtensionAPI) {
	// Fast path: agent_end with no pending messages (single-turn plan executions).
	pi.on("agent_end", async (_event, ctx) => {
		if (ctx.hasPendingMessages()) return;

		const entries = ctx.sessionManager.getEntries();
		const artifactsDir = ctx.sessionManager.getArtifactsDir();
		const cwd = ctx.sessionManager.getCwd?.() ?? process.cwd();

		await processPlanCompletion(pi, cwd, artifactsDir, entries);
	});

	// Fallback: session_stop fires when the session settles after multi-turn
	// plan executions (user interruptions, mode switches, approvals).
	// Uses deterministic todo-state check instead of hasPendingMessages().
	pi.on("session_stop", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();

		// Only fire if plan execution is actually complete (deterministic todo check)
		if (!isPlanExecutionComplete(entries)) return;

		const artifactsDir = ctx.sessionManager.getArtifactsDir();
		const cwd = ctx.sessionManager.getCwd?.() ?? process.cwd();

		const triggered = await processPlanCompletion(pi, cwd, artifactsDir, entries);
		if (!triggered) return;

		// Request one continuation turn to generate the report
		return {
			continue: true,
			additionalContext: "[SYSTEM - plan-report extension]: A plan just completed. Generate the implementation report as instructed in the follow-up message.",
		};
	});
}
