import { afterEach, describe, expect, it } from "bun:test";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

// Contract: while ask mode is active the model must actually receive the
// ask-mode directive, and lose it again on the very next prompt rebuild after
// the mode ends. The directive rides the system prompt — not a history message
// — because `#setActiveMode` rebuilds that prompt wholesale on every
// transition: a history copy would survive the exit and keep telling the model
// it may not edit.
//
// Regression guard for the fork-side wiring in `sdk.ts#rebuildSystemPrompt`,
// which is where the directive is appended; rebuilding through the real session
// (not a stubbed `rebuildSystemPrompt`) is the point of the test.

const DIRECTIVE_FRAGMENT = 'call the `switch_mode` tool with `mode="agent"`';

describe("ask mode context injection", () => {
	const sessions: AgentSession[] = [];
	const tempDirs: TempDir[] = [];

	afterEach(async () => {
		for (const session of sessions.splice(0)) {
			await session.dispose();
		}
		for (const dir of tempDirs.splice(0)) {
			await dir.remove();
		}
	});

	async function createSession(): Promise<AgentSession> {
		const tempDir = await TempDir.create();
		tempDirs.push(tempDir);
		const model = buildModel({
			id: "ask-mode-context",
			name: "ask mode context",
			api: "openai-responses",
			provider: "openai",
			baseUrl: "http://127.0.0.1:8080/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 8192,
			maxTokens: 1024,
		}) as Model<Api>;
		const authStorage = await AuthStorage.create(tempDir.join("auth.db"));
		authStorage.setRuntimeApiKey(model.provider, "test-key");
		const modelRegistry = new ModelRegistry(authStorage, tempDir.join("models.yml"));
		const { session } = await createAgentSession({
			cwd: tempDir.path(),
			agentDir: tempDir.path(),
			sessionManager: SessionManager.inMemory(tempDir.path()),
			authStorage,
			modelRegistry,
			settings: Settings.isolated({ "compaction.enabled": false, "todo.enabled": false }),
			model,
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			skipPythonPreflight: true,
		});
		sessions.push(session);
		return session;
	}

	it("carries the directive into ask mode and drops it on exit", async () => {
		const session = await createSession();
		expect(session.agent.state.systemPrompt.join("\n")).not.toContain(DIRECTIVE_FRAGMENT);

		session.enableAskMode();
		await session.refreshBaseSystemPrompt();
		expect(session.agent.state.systemPrompt.join("\n")).toContain(DIRECTIVE_FRAGMENT);

		await session.disableAskMode();
		await session.refreshBaseSystemPrompt();
		expect(session.agent.state.systemPrompt.join("\n")).not.toContain(DIRECTIVE_FRAGMENT);
	});
});
