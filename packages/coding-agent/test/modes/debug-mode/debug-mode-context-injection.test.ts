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

// Contract: while debug mode is active the model must actually receive the
// debug-mode directive (with its placeholders rendered), and lose it again on
// the very next prompt rebuild after the mode ends. The directive rides the
// system prompt — not a history message — because `#setActiveMode` rebuilds
// that prompt wholesale on every transition: a history copy would survive the
// exit and keep pointing the model at instrumentation.
//
// Regression guard for the fork-side wiring in `sdk.ts#rebuildSystemPrompt`,
// which is where the directive is appended; rebuilding through the real session
// is the point of the test.

const DIRECTIVE_FRAGMENT = "You are now in **DEBUG MODE**";

describe("debug mode context injection", () => {
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
			id: "debug-mode-context",
			name: "debug mode context",
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

	it("carries the directive into debug mode and drops it on exit", async () => {
		const session = await createSession();
		expect(session.agent.state.systemPrompt.join("\n")).not.toContain(DIRECTIVE_FRAGMENT);

		await session.enableDebugMode();
		await session.refreshBaseSystemPrompt();
		const during = session.agent.state.systemPrompt.join("\n");
		expect(during).toContain(DIRECTIVE_FRAGMENT);
		// Placeholders are rendered with the live endpoint, not left as template text.
		expect(during).toMatch(/http:\/\/127\.0\.0\.1:\d+\/ingest\//);
		expect(during).not.toContain("{{ingestUrl}}");
		expect(during).not.toContain("{{logPath}}");
		expect(during).not.toContain("{{sessionId}}");

		await session.disableDebugMode();
		await session.refreshBaseSystemPrompt();
		expect(session.agent.state.systemPrompt.join("\n")).not.toContain(DIRECTIVE_FRAGMENT);
	});
});
