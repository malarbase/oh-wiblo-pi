import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { _resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { TempDir } from "@oh-my-pi/pi-utils";
import { ModelRegistry } from "../../src/config/model-registry";
import { InteractiveMode } from "../../src/modes/interactive-mode";
import { AgentSession } from "../../src/session/agent-session";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";

describe("handlePlanRunCommand / handlePlanListCommand", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;
	let mode: InteractiveMode;

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		_resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-plan-run-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = modelRegistry.find("anthropic", "claude-sonnet-4-5");
		if (!model) {
			throw new Error("Expected claude-sonnet-4-5 to exist in registry");
		}
		session = new AgentSession({
			agent: new Agent({
				initialState: {
					model,
					systemPrompt: "Test",
					tools: [],
					messages: [],
				},
			}),
			sessionManager: SessionManager.create(tempDir.path(), tempDir.path()),
			settings: Settings.isolated(),
			modelRegistry,
		});
		mode = new InteractiveMode(session, "test");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		mode?.stop();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		_resetSettingsForTest();
	});

	it("runs an existing project plan by name", async () => {
		const plansDir = path.join(tempDir.path(), ".omp", "plans");
		await fs.mkdir(plansDir, { recursive: true });
		await Bun.write(path.join(plansDir, "FOO_PLAN.md"), "# FOO\n\nDo things.");

		vi.spyOn(session, "abort").mockResolvedValue(undefined);
		vi.spyOn(session, "prompt").mockResolvedValue(undefined);
		vi.spyOn(session, "setActiveToolsByName").mockResolvedValue(undefined);
		vi.spyOn(mode, "handleClearCommand").mockResolvedValue(undefined);

		await mode.handlePlanRunCommand("FOO_PLAN");

		expect(session.prompt).toHaveBeenCalled();
	});

	it("does NOT clear session when --keep is passed", async () => {
		const plansDir = path.join(tempDir.path(), ".omp", "plans");
		await fs.mkdir(plansDir, { recursive: true });
		await Bun.write(path.join(plansDir, "FOO_PLAN.md"), "# FOO\n\nDo things.");

		vi.spyOn(session, "abort").mockResolvedValue(undefined);
		vi.spyOn(session, "prompt").mockResolvedValue(undefined);
		vi.spyOn(session, "setActiveToolsByName").mockResolvedValue(undefined);
		const clearSpy = vi.spyOn(mode, "handleClearCommand").mockResolvedValue(undefined);

		await mode.handlePlanRunCommand("FOO_PLAN --keep");

		expect(clearSpy).not.toHaveBeenCalled();
		expect(session.prompt).toHaveBeenCalled();
	});

	it("shows error and does not prompt when plan is missing", async () => {
		vi.spyOn(session, "prompt").mockResolvedValue(undefined);
		const errorSpy = vi.spyOn(mode, "showError").mockImplementation(() => {});

		await mode.handlePlanRunCommand("DOES_NOT_EXIST");

		expect(errorSpy).toHaveBeenCalled();
		expect(session.prompt).not.toHaveBeenCalled();
	});

	it("shows plan names when saved plans exist", async () => {
		const plansDir = path.join(tempDir.path(), ".omp", "plans");
		await fs.mkdir(plansDir, { recursive: true });
		await Bun.write(path.join(plansDir, "MY_PLAN.md"), "# MY PLAN");

		const statusSpy = vi.spyOn(mode, "showStatus").mockImplementation(() => {});

		await mode.handlePlanListCommand();

		expect(statusSpy).toHaveBeenCalled();
		const call = statusSpy.mock.calls[0]?.[0] ?? "";
		expect(call).toContain("MY_PLAN");
	});

	it("shows 'No saved plans' when no plans exist", async () => {
		const statusSpy = vi.spyOn(mode, "showStatus").mockImplementation(() => {});

		await mode.handlePlanListCommand();

		expect(statusSpy).toHaveBeenCalled();
		const call = statusSpy.mock.calls[0]?.[0] ?? "";
		expect(call).toContain("No saved plans");
	});
});
