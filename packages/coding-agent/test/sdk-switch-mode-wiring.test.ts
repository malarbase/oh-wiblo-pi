/**
 * The `switch_mode` tool is wired end to end: the tool asks the session, the
 * session asks the mode controller (the TUI), and the outcome comes back in
 * the tool's result — the only place the model can read it.
 */
import { describe, expect, it } from "bun:test";
import { AuthStorage } from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

import type { ModeSwitchOutcome } from "@oh-my-pi/pi-coding-agent/modes/mode-state";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { SwitchModeTool } from "@oh-my-pi/pi-coding-agent/tools/switch-mode";

async function createSession(cwd: string) {
	const authStorage = await AuthStorage.create(`${cwd}/auth.db`);
	const model = getBundledModel("openai", "gpt-4o-mini");
	const modelRegistry = new ModelRegistry(authStorage, `${cwd}/models.json`);
	const sessionManager = SessionManager.inMemory(cwd);
	const { session } = await createAgentSession({
		cwd,
		agentDir: cwd,
		modelRegistry,
		sessionManager,
		settings: Settings.isolated({}),
		model,
		disableExtensionDiscovery: true,
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
		toolNames: [],
		restrictToolNames: true,
		skipPythonPreflight: true,
	});
	return { session, authStorage };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content.find(part => part.type === "text")?.text ?? "";
}

describe("switch_mode wiring", () => {
	it("reaches the mode controller and reports its outcome", async () => {
		using tempDir = TempDir.createSync("@omp-switch-wiring-");
		const { session, authStorage } = await createSession(tempDir.path());
		try {
			const asked: string[] = [];
			const outcome: ModeSwitchOutcome = {
				status: "switched",
				mode: "ask",
				message: "Harness mode: ask. Switched to ask mode.",
			};
			// What the TUI registers: the live mode and the switch itself.
			session.setModeController({
				getModeSnapshot: () => ({ mode: "none", planPaused: false, goalPaused: false }),
				requestModeSwitch: async (target, reason) => {
					asked.push(`${target}:${reason ?? ""}`);
					return outcome;
				},
			});

			const toolSession = { getModeSnapshot: () => session.getModeSnapshot() } as ToolSession;
			const tool = new SwitchModeTool({
				...toolSession,
				requestModeSwitch: (target, reason) => session.requestModeSwitch(target, reason),
			});

			const result = await tool.execute("call-1", { mode: "ask", reason: "read-only review" });
			expect(asked).toEqual(["ask:read-only review"]);
			expect(result.details).toEqual({
				targetMode: "ask",
				reason: "read-only review",
				currentMode: "ask",
				outcome: "switched",
			});
			expect(textOf(result)).toBe("Harness mode: ask. Switched to ask mode.");
		} finally {
			await session.dispose();
			authStorage.close();
		}
	});

	it("reports the mode the session derives, without asking the user", async () => {
		using tempDir = TempDir.createSync("@omp-switch-wiring-noop-");
		const { session, authStorage } = await createSession(tempDir.path());
		try {
			let asked = 0;
			session.setModeController({
				getModeSnapshot: () => ({ mode: "plan", planPaused: false, goalPaused: false }),
				requestModeSwitch: async () => {
					asked++;
					return { status: "switched", mode: "plan", message: "unused" };
				},
			});

			const tool = new SwitchModeTool({
				getModeSnapshot: () => session.getModeSnapshot(),
				requestModeSwitch: (target, reason) => session.requestModeSwitch(target, reason),
			} as ToolSession);

			const result = await tool.execute("call-2", { mode: "plan" });
			expect(asked).toBe(0);
			expect(result.details?.outcome).toBe("already");
			expect(textOf(result)).toContain("Already in plan mode");
		} finally {
			await session.dispose();
			authStorage.close();
		}
	});
});
