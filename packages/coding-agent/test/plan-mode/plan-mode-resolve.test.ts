import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { resolveLocalUrlToPath } from "@oh-my-pi/pi-coding-agent/internal-urls";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { TempDir } from "@oh-my-pi/pi-utils";
import { ModelRegistry } from "../../src/config/model-registry";
import { InteractiveMode } from "../../src/modes/interactive-mode";
import { AgentSession } from "../../src/session/agent-session";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";
import type { ToolSession } from "../../src/tools";
import { dispatchResolutionDevice } from "../../src/tools/resolve";

describe("Plan mode resolve integration", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;
	let mode: InteractiveMode;

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-plan-resolve-");
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
					systemPrompt: ["Test"],
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
		resetSettingsForTest();
	});

	it("resolve tool throws when plan mode is NOT active", async () => {
		await expect(
			dispatchResolutionDevice(session as unknown as ToolSession, "resolve", "Plan is complete"),
		).rejects.toThrow("No pending action to apply");
	});

	it("resolve device finds proposal handler when plan mode IS active", async () => {
		const planFilePath = "local://PLAN.md";
		const resolvedPlanPath = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(resolvedPlanPath, "# Test Plan\n\nDo the thing.");

		vi.spyOn(mode, "showStatus").mockImplementation(() => {});
		vi.spyOn(mode.sessionManager, "appendModeChange").mockImplementation(() => "");

		// Enter plan mode - this should register the plan proposal handler
		await mode.handlePlanModeCommand();

		// Confirm that plan proposal handler is registered
		expect(session.peekPlanProposalHandler()).toBeDefined();

		// Now dispatching propose device should NOT throw - it should dispatch to proposal handler
		const { result } = await dispatchResolutionDevice(session as unknown as ToolSession, "propose", "TEST_PLAN");

		const details = result.details as any;
		expect(details?.planFilePath).toBe("local://PLAN.md");
		expect(details?.title).toBe("TEST_PLAN");
		expect(details?.planExists).toBe(true);
	});

	it("standing handler is cleared when plan mode exits", async () => {
		vi.spyOn(mode, "showStatus").mockImplementation(() => {});
		vi.spyOn(mode.sessionManager, "appendModeChange").mockImplementation(() => "");

		await mode.handlePlanModeCommand();
		expect(session.peekPlanProposalHandler()).toBeDefined();

		const planFilePath = "local://PLAN.md";
		const resolvedPlanPath = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(resolvedPlanPath, "# Draft Plan\n\nDraft content.");

		// Toggle off
		const confirmSpy = vi.spyOn(mode, "showHookConfirm").mockResolvedValue(true);
		await mode.handlePlanModeCommand();
		expect(confirmSpy).toHaveBeenCalledWith("Exit plan mode?", expect.any(String));

		expect(session.peekPlanProposalHandler()).toBeUndefined();
	});

	it("resolve tool finds standing handler when plan mode is activated directly on session", async () => {
		const planFilePath = "local://PLAN.md";
		const resolvedPlanPath = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(resolvedPlanPath, "# Test Plan\n\nDo the thing.");

		// Activate plan mode directly on the session without InteractiveMode involvement.
		session.setPlanModeState({
			enabled: true,
			planFilePath,
			workflow: "parallel",
		});

		expect(session.peekPlanProposalHandler()).toBeDefined();

		const { result } = await dispatchResolutionDevice(session as unknown as ToolSession, "propose", "DIRECT_PLAN");

		const detailsDirect = result.details as any;
		expect(detailsDirect?.planFilePath).toBe("local://PLAN.md");
		expect(detailsDirect?.title).toBe("DIRECT_PLAN");
		expect(detailsDirect?.planExists).toBe(true);
	});

	it("reject device when no pending action returns without error", async () => {
		const planFilePath = "local://PLAN.md";
		const resolvedPlanPath = resolveLocalUrlToPath(planFilePath, {
			getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
			getSessionId: () => session.sessionManager.getSessionId(),
		});
		await Bun.write(resolvedPlanPath, "# Test Plan\n\nDo the thing.");

		vi.spyOn(mode, "showStatus").mockImplementation(() => {});
		vi.spyOn(mode.sessionManager, "appendModeChange").mockImplementation(() => "");
		await mode.handlePlanModeCommand();

		const handlePlanApprovalSpy = vi.spyOn(mode, "handlePlanApproval").mockResolvedValue();

		const { result } = await dispatchResolutionDevice(session as unknown as ToolSession, "reject", "Not ready yet");

		expect(handlePlanApprovalSpy).not.toHaveBeenCalled();
		expect((result.details as any)?.action).toBe("discard");
	});
});
