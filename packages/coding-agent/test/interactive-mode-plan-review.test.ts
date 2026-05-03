import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { _resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { resolveLocalUrlToPath } from "@oh-my-pi/pi-coding-agent/internal-urls";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { Text } from "@oh-my-pi/pi-tui";
import { TempDir } from "@oh-my-pi/pi-utils";
import { ModelRegistry } from "../src/config/model-registry";
import { InteractiveMode } from "../src/modes/interactive-mode";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";

describe("InteractiveMode plan review rendering", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;
	let mode: InteractiveMode;

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		_resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-plan-review-");
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

	it("re-appends refreshed plan review previews at the chat tail", async () => {
		const planFilePath = "local://PLAN.md";
		const resolvedPlanPath = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(resolvedPlanPath, "# First plan\n\nalpha");

		vi.spyOn(mode, "showStatus").mockImplementation(() => {});
		vi.spyOn(mode.sessionManager, "appendModeChange").mockImplementation(() => "");
		await mode.handlePlanModeCommand();
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Stay in plan mode");

		await mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: "local://PLAN.md",
		});

		const firstPreview = mode.chatContainer.children.at(-1);
		expect(firstPreview).toBeDefined();
		expect(firstPreview!.render(120).join("\n")).toContain("First plan");

		const marker = new Text("MARKER", 0, 0);
		mode.chatContainer.addChild(marker);
		await Bun.write(resolvedPlanPath, "# Second plan\n\nbeta");

		await mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: "local://PLAN.md",
		});

		expect(mode.chatContainer.children.at(-1)).toBe(firstPreview);
		expect(mode.chatContainer.children.at(-2)).toBe(marker);
		expect(firstPreview!.render(120).join("\n")).toContain("Second plan");
	});
	it("handleExitPlanModeTool selector includes 'Save and exit' in 4 options", async () => {
		const planFilePath = "local://PLAN.md";
		const resolvedPlanPath = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(resolvedPlanPath, "# Test plan\n");
		vi.spyOn(mode, "showStatus").mockImplementation(() => {});
		vi.spyOn(mode.sessionManager, "appendModeChange").mockImplementation(() => "");
		await mode.handlePlanModeCommand();
		vi.spyOn(session, "abort").mockResolvedValue(undefined);

		let capturedOptions: string[] = [];
		vi.spyOn(mode, "showHookSelector").mockImplementation(async (_title: string, options: string[]) => {
			capturedOptions = [...options];
			return "Stay in plan mode";
		});

		await mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: planFilePath,
		});

		expect(capturedOptions).toEqual(["Approve and execute", "Save and exit", "Refine plan", "Stay in plan mode"]);
	});

	it("Save and exit with valid title saves plan, exits plan mode, does NOT clear session", async () => {
		const planFilePath = "local://PLAN.md";
		const resolvedPlanPath = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(resolvedPlanPath, "# My plan\n");
		vi.spyOn(mode, "showStatus").mockImplementation(() => {});
		vi.spyOn(mode.sessionManager, "appendModeChange").mockImplementation(() => "");
		await mode.handlePlanModeCommand();
		vi.spyOn(session, "abort").mockResolvedValue(undefined);
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Save and exit");
		vi.spyOn(mode, "showHookInput").mockResolvedValue("MY_PLAN");
		const clearSpy = vi.spyOn(mode, "handleClearCommand").mockResolvedValue(undefined);
		const promptSpy = vi.spyOn(session, "prompt").mockResolvedValue(undefined);

		await mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: planFilePath,
		});

		expect(mode.planModeEnabled).toBe(false);
		expect(clearSpy).not.toHaveBeenCalled();
		expect(promptSpy).not.toHaveBeenCalled();

		const resolvedDestPath = resolveLocalUrlToPath("local://MY_PLAN.md", {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		expect(await Bun.file(resolvedDestPath).exists()).toBe(true);
	});

	it("Save and exit with empty title (user cancels) does nothing", async () => {
		const planFilePath = "local://PLAN.md";
		const resolvedPlanPath = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(resolvedPlanPath, "# My plan\n");
		vi.spyOn(mode, "showStatus").mockImplementation(() => {});
		vi.spyOn(mode.sessionManager, "appendModeChange").mockImplementation(() => "");
		await mode.handlePlanModeCommand();
		vi.spyOn(session, "abort").mockResolvedValue(undefined);
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Save and exit");
		vi.spyOn(mode, "showHookInput").mockResolvedValue(undefined);

		await mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: planFilePath,
		});

		expect(mode.planModeEnabled).toBe(true);
	});

	it("Save and exit with invalid title shows error, plan mode stays active", async () => {
		const planFilePath = "local://PLAN.md";
		const resolvedPlanPath = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(resolvedPlanPath, "# My plan\n");
		vi.spyOn(mode, "showStatus").mockImplementation(() => {});
		vi.spyOn(mode.sessionManager, "appendModeChange").mockImplementation(() => "");
		await mode.handlePlanModeCommand();
		vi.spyOn(session, "abort").mockResolvedValue(undefined);
		vi.spyOn(mode, "showHookSelector").mockResolvedValue("Save and exit");
		vi.spyOn(mode, "showHookInput").mockResolvedValue("../bad/path");
		const showErrorSpy = vi.spyOn(mode, "showError").mockImplementation(() => {});

		await mode.handleExitPlanModeTool({
			planFilePath,
			planExists: true,
			title: "PLAN",
			finalPlanFilePath: planFilePath,
		});

		expect(showErrorSpy).toHaveBeenCalled();
		expect(mode.planModeEnabled).toBe(true);
	});
});
