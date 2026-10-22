/**
 * The system prompt states the mode the harness is in.
 *
 * Without that line the model can only infer the mode from the presence of a
 * mode context, and a mode change that leaves no trace in the prompt (a plan
 * approval) leaves it guessing — which is how it ends up asking for a switch
 * it is already in. The line is derived from the live mode and rebuilt with
 * the prompt on every transition.
 */
import { describe, expect, it } from "bun:test";
import { AuthStorage } from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

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

describe("the current mode in the system prompt", () => {
	it("states the mode, and follows it when the mode changes", async () => {
		using tempDir = TempDir.createSync("@omp-current-mode-");
		const { session, authStorage } = await createSession(tempDir.path());
		try {
			expect(session.systemPrompt.join("\n")).toContain("Current harness mode: agent.");

			// The TUI owns the mode; it hands the session the live snapshot.
			session.setModeController({
				getModeSnapshot: () => ({ mode: "plan", planPaused: false, goalPaused: false }),
				requestModeSwitch: async () => ({
					status: "switched" as const,
					mode: "plan" as const,
					message: "unused",
				}),
			});
			await session.refreshBaseSystemPrompt();

			const prompt = session.systemPrompt.join("\n");
			expect(prompt).toContain("Current harness mode: plan.");
			expect(prompt).not.toContain("Current harness mode: agent.");
		} finally {
			await session.dispose();
			authStorage.close();
		}
	});

	it("marks a suspended plan as paused", async () => {
		using tempDir = TempDir.createSync("@omp-current-mode-paused-");
		const { session, authStorage } = await createSession(tempDir.path());
		try {
			session.setModeController({
				getModeSnapshot: () => ({ mode: "plan", planPaused: true, goalPaused: false }),
				requestModeSwitch: async () => ({
					status: "switched" as const,
					mode: "plan" as const,
					message: "unused",
				}),
			});
			await session.refreshBaseSystemPrompt();

			expect(session.systemPrompt.join("\n")).toContain("Current harness mode: plan (paused).");
		} finally {
			await session.dispose();
			authStorage.close();
		}
	});
});
