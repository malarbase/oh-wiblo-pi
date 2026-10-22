/**
 * The mode a session is in is derived from the live flags, never cached.
 *
 * A cached mode goes stale the moment the mode changes outside the switch
 * routine — a plan approval, `/plan`, `/plan load`, a session restore — and a
 * stale mode makes `switch_mode` claim the harness is somewhere it is not
 * ("Already in plan mode" while the harness is in agent mode, and a switch
 * that never happens). These tests drive the production routine.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { InteractiveMode } from "@oh-my-pi/pi-coding-agent/modes/interactive-mode";
import { cfgPlanEnabled } from "@oh-my-pi/pi-coding-agent/plan-mode/settings";
import { deriveModeSnapshot } from "@oh-my-pi/pi-coding-agent/modes/mode-state";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import * as theme from "@oh-my-pi/pi-tui/theme";
import { TempDir } from "@oh-my-pi/pi-utils";

describe("mode switching", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;
	let mode: InteractiveMode;

	beforeAll(async () => {
		await theme.initTheme();
	});

	beforeEach(async () => {
		resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-mode-switch-");
		const settings = await Settings.init({
			inMemory: true,
			cwd: tempDir.path(),
			overrides: { "startup.quiet": true },
		});
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = modelRegistry.find("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected claude-sonnet-4-5 to exist in registry");
		session = new AgentSession({
			agent: new Agent({ initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] } }),
			sessionManager: SessionManager.create(tempDir.path(), tempDir.path()),
			settings,
			modelRegistry,
		});
		mode = new InteractiveMode(session, "test");
		await mode.init({ suppressWelcomeIntro: true });
	});

	afterEach(async () => {
		mode?.stop();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
	});

	describe("derivation", () => {
		it("reads the mode off the live flags", () => {
			expect(
				deriveModeSnapshot({
					askModeEnabled: false,
					debugModeEnabled: false,
					planModeEnabled: false,
					planModePaused: false,
					goalModeEnabled: false,
					goalModePaused: false,
				}).mode,
			).toBe("none");
			expect(
				deriveModeSnapshot({
					askModeEnabled: true,
					debugModeEnabled: false,
					planModeEnabled: false,
					planModePaused: false,
					goalModeEnabled: false,
					goalModePaused: false,
				}).mode,
			).toBe("ask");
		});

		it("keeps a paused plan a plan session", () => {
			const paused = deriveModeSnapshot({
				askModeEnabled: false,
				debugModeEnabled: false,
				planModeEnabled: false,
				planModePaused: true,
				goalModeEnabled: false,
				goalModePaused: false,
			});
			expect(paused.mode).toBe("plan");
			expect(paused.planPaused).toBe(true);
		});
	});

	describe("requestModeSwitch", () => {
		it("asks the user and switches when the mode differs", async () => {
			const confirm = vi.spyOn(mode, "showHookConfirm").mockResolvedValue(true);
			const outcome = await mode.requestModeSwitch("ask", "read-only review");
			expect(confirm).toHaveBeenCalledTimes(1);
			expect(outcome.status).toBe("switched");
			expect(outcome.mode).toBe("ask");
			expect(outcome.message).toBe("Harness mode: ask. Switched to ask mode.");
			expect(mode.modeSnapshot.mode).toBe("ask");
		});

		it("hands the session the live mode, so a tool can read it", async () => {
			// The tool layer has no access to the TUI; it reads the mode through
			// the session. If the TUI did not register itself, the session would
			// answer "agent" for every mode.
			expect(session.getModeSnapshot().mode).toBe("none");
			vi.spyOn(mode, "showHookConfirm").mockResolvedValue(true);
			await mode.requestModeSwitch("ask");
			expect(session.getModeSnapshot().mode).toBe("ask");
		});

		it("does not ask the user when the harness is already in the target mode", async () => {
			const confirm = vi.spyOn(mode, "showHookConfirm").mockResolvedValue(true);
			await mode.requestModeSwitch("ask");
			confirm.mockClear();
			const outcome = await mode.requestModeSwitch("ask");
			expect(confirm).not.toHaveBeenCalled();
			expect(outcome.status).toBe("already");
			expect(outcome.message).toBe("Harness mode: ask. Already in ask mode — no switch performed.");
		});

		it("reports the mode the harness stayed in when the user declines", async () => {
			vi.spyOn(mode, "showHookConfirm").mockResolvedValue(false);
			const outcome = await mode.requestModeSwitch("ask");
			expect(outcome.status).toBe("cancelled");
			expect(outcome.mode).toBe("none");
			expect(outcome.message).toContain("the harness is still in agent mode");
		});

		it("sees the mode a plan approval left behind", async () => {
			// A plan approval exits plan mode without running the switch
			// routine: the harness is in agent mode, so a request for plan mode
			// is a real switch and has to reach the user.
			mode.planModeEnabled = false;
			mode.planModePaused = false;
			const confirm = vi.spyOn(mode, "showHookConfirm").mockResolvedValue(true);
			const outcome = await mode.requestModeSwitch("plan");
			expect(confirm).toHaveBeenCalledTimes(1);
			expect(outcome.status).not.toBe("already");
		});

		it("treats a paused plan as a plan session, so requesting it is a resume", async () => {
			mode.planModeEnabled = false;
			mode.planModePaused = true;
			const confirm = vi.spyOn(mode, "showHookConfirm").mockResolvedValue(true);
			const outcome = await mode.requestModeSwitch("plan");
			expect(confirm).toHaveBeenCalledTimes(1);
			expect(outcome.status).not.toBe("already");
		});

		it("refuses plan mode when the settings disable it", async () => {
			// The same gate `/plan` applies: a model-initiated switch must not
			// enter a mode the user switched off.
			cfgPlanEnabled.set(session.settings, false);
			try {
				const confirm = vi.spyOn(mode, "showHookConfirm").mockResolvedValue(true);
				const outcome = await mode.requestModeSwitch("plan");
				expect(confirm).not.toHaveBeenCalled();
				expect(outcome.status).toBe("failed");
				expect(outcome.message).toContain("plan.enabled");
				expect(mode.modeSnapshot.mode).toBe("none");
			} finally {
				cfgPlanEnabled.set(session.settings, true);
			}
		});
	});
});
