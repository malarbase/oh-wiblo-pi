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

// Contract: `/new` re-runs skill discovery through the refreshSkills seam when
// `skills.rediscoverOnNewSession` is on (default) and the disabled-extension
// set changed since the last discovery, so mid-session skill toggles take
// effect on the next session's prompt. With the setting off — or with an
// unchanged disabled set (same set, same result) — no re-scan happens.
//
// The spy wraps the real seam, so a re-run still performs discovery and the
// prompt rebuild; only the call is observed.

describe("/new skill rediscovery", () => {
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

	async function createSession(rediscoverOnNewSession: boolean): Promise<AgentSession> {
		const tempDir = await TempDir.create();
		tempDirs.push(tempDir);
		const model = buildModel({
			id: "skill-rediscovery",
			name: "skill rediscovery",
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
			settings: Settings.isolated({
				"compaction.enabled": false,
				"todo.enabled": false,
				"skills.rediscoverOnNewSession": rediscoverOnNewSession,
			}),
			model,
			disableExtensionDiscovery: true,
			// No explicit skills: the session must be skillsReloadable for the
			// refresh seam to actually re-scan the disk.
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

	function spyOnRefreshSkills(session: AgentSession): { calls: () => number } {
		const original = session.refreshSkills.bind(session);
		let calls = 0;
		session.refreshSkills = async () => {
			calls++;
			await original();
		};
		return { calls: () => calls };
	}

	it("re-runs discovery when the setting is on and the disabled set changed", async () => {
		const session = await createSession(true);
		const spy = spyOnRefreshSkills(session);

		session.settings.override("disabledExtensions", ["skill:mid-session-toggle"]);
		expect(await session.newSession()).toBe(true);
		expect(spy.calls()).toBe(1);
	});

	it("does not re-run discovery when the setting is off", async () => {
		const session = await createSession(false);
		const spy = spyOnRefreshSkills(session);

		session.settings.override("disabledExtensions", ["skill:mid-session-toggle"]);
		expect(await session.newSession()).toBe(true);
		expect(spy.calls()).toBe(0);
	});

	it("skips re-discovery when the disabled set is unchanged", async () => {
		const session = await createSession(true);
		const spy = spyOnRefreshSkills(session);

		expect(await session.newSession()).toBe(true);
		expect(spy.calls()).toBe(0);
	});
});
