import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

// Contract: enabling debug mode starts a log-ingestion server whose endpoint is
// reachable while the mode is active; disabling it stops the server, so the
// endpoint baked into the prompt dies with the mode. Reachability is probed
// with a plain TCP connect (no HTTP client): connect success proves the bound
// listener, connect refusal proves the teardown.

function probe(port: number): Promise<boolean> {
	const { promise, resolve } = Promise.withResolvers<boolean>();
	const socket = net.connect({ port, host: "127.0.0.1" });
	socket.once("connect", () => {
		socket.destroy();
		resolve(true);
	});
	socket.once("error", () => {
		socket.destroy();
		resolve(false);
	});
	return promise;
}

describe("debug mode log server", () => {
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
			id: "debug-log-server",
			name: "debug log server",
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

	it("serves while debug mode is on and stops when it exits", async () => {
		const session = await createSession();
		expect(session.getModeContextPrompt()).toBeUndefined();

		await session.enableDebugMode();
		const context = session.getModeContextPrompt();
		expect(context).toBeTruthy();
		// The directive the model is shown carries the live endpoint and log path.
		const endpoint = context?.match(/http:\/\/127\.0\.0\.1:(\d+)\/ingest\//);
		expect(endpoint).toBeTruthy();
		const logPath = context?.match(/\*\*Log path\*\*: `([^`]+)`/)?.[1];
		expect(logPath).toBeTruthy();
		expect(fs.existsSync(path.dirname(logPath ?? ""))).toBe(true);

		const port = Number(endpoint?.[1]);
		expect(Number.isInteger(port)).toBe(true);
		expect(await probe(port)).toBe(true);

		await session.disableDebugMode();
		expect(session.getModeContextPrompt()).toBeUndefined();
		expect(await probe(port)).toBe(false);
	});
});
