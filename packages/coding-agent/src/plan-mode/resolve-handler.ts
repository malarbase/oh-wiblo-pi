/**
 * Plan approval resolve handler.
 *
 * Extracted from InteractiveMode so that plan-mode resolve works regardless
 * of whether plan mode was entered via the interactive UI or via harness
 * directive.
 */

import * as path from "node:path";
import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";
import { isEnoent } from "@oh-my-pi/pi-utils";
import { resolveLocalUrlToPath } from "../internal-urls";
import { normalizeLocalScheme } from "../tools/path-utils";
import { type ResolveDetails, runResolveInvocation } from "../tools/resolve";
import { ToolError } from "../tools/tool-errors";
import { type PlanApprovalDetails, resolvePlanTitle } from "./approved-plan";
import type { PlanModeState } from "./state";
import { getFinalPlanPath, type PlanStorage } from "./storage";

export interface PlanApprovalSession {
	getPlanModeState(): PlanModeState | undefined;
	getArtifactsDir(): string | null;
	getSessionId(): string | null;
	getCwd(): string;
	getSettings(): { get(key: string): unknown };
}

function resolvePlanFilePath(planFilePath: string, session: PlanApprovalSession): string {
	if (planFilePath.startsWith("local:")) {
		const normalized = normalizeLocalScheme(planFilePath);
		return resolveLocalUrlToPath(normalized, {
			getArtifactsDir: () => session.getArtifactsDir(),
			getSessionId: () => session.getSessionId(),
		});
	}
	return path.resolve(session.getCwd(), planFilePath);
}

async function readPlanFile(planFilePath: string, session: PlanApprovalSession): Promise<string | null> {
	const resolvedPath = resolvePlanFilePath(planFilePath, session);
	try {
		return await Bun.file(resolvedPath).text();
	} catch (error) {
		if (isEnoent(error)) {
			return null;
		}
		throw error;
	}
}

export function createPlanApprovalResolveHandler(
	session: PlanApprovalSession,
): (input: unknown) => Promise<AgentToolResult<ResolveDetails>> {
	return input =>
		runResolveInvocation(input as Parameters<typeof runResolveInvocation>[0], {
			sourceToolName: "plan_approval",
			label: "Plan ready for approval",
			apply: async (reason: string) => {
				const state = session.getPlanModeState();
				if (!state?.enabled) {
					throw new ToolError("Plan mode is not active.");
				}
				const planFilePath = state.planFilePath;
				const planContent = await readPlanFile(planFilePath, session);
				if (planContent === null) {
					throw new ToolError(
						`Plan file not found at ${planFilePath}. Write the finalized plan to ${planFilePath} before requesting approval.`,
					);
				}
				const normalized = resolvePlanTitle({
					suppliedTitle: reason,
					planContent,
					planFilePath,
				});
				const storage = (session.getSettings().get("plan.storage") ?? "session") as PlanStorage;
				const finalPlanFilePath =
					storage === "project"
						? getFinalPlanPath(storage, { cwd: session.getCwd() }, normalized.fileName)
						: `local://${normalized.fileName}`;
				const details: PlanApprovalDetails = {
					planFilePath,
					finalPlanFilePath,
					title: normalized.title,
					planExists: true,
				};
				return {
					content: [{ type: "text" as const, text: "Plan ready for approval." }],
					details,
				};
			},
		});
}
