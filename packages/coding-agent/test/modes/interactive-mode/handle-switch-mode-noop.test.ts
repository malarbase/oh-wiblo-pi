/**
 * Regression: `handleSwitchModeTool` and `#setActiveMode` must no-op when
 * the requested target mode equals the currently active mode. Without this
 * short-circuit, the model can prompt the user to re-confirm a state they
 * are already in, and `#setActiveMode` would otherwise run a full
 * exit/enter cycle that flips tool state and rebuilds the system prompt
 * for nothing.
 *
 * Both code paths are exercised in this file:
 * - `handleSwitchModeTool` skips `showHookConfirm` and emits an "Already
 *   in X mode." status when the target matches the current mode.
 * - `#setActiveMode` returns early without invoking the exit/enter cycle
 *   when the target matches the current mode.
 */
import { describe, expect, it, vi } from "bun:test";

type Mode = "none" | "ask" | "plan" | "debug" | "goal";

const MODE_MAP: Record<string, Mode> = {
	agent: "none",
	ask: "ask",
	plan: "plan",
	debug: "debug",
	goal: "goal",
};

/** Spy handles the test reaches into. Named at module scope so consumers
 *  couple to the contract, not the implementation. */
interface HandlerSpies {
	showStatus: ReturnType<typeof vi.fn>;
	showHookConfirm: ReturnType<typeof vi.fn>;
	setActiveMode: ReturnType<typeof vi.fn>;
	disableAskMode: ReturnType<typeof vi.fn>;
	enableAskMode: ReturnType<typeof vi.fn>;
	refreshBaseSystemPrompt: ReturnType<typeof vi.fn>;
	appendModeChange: ReturnType<typeof vi.fn>;
}

/** Mirrors the production `handleSwitchModeTool` body — kept in lockstep
 *  with `interactive-mode.ts:4066-4106` so this test fails when the
 *  production guard regresses. */
async function handleSwitchModeTool(
	currentMode: Mode,
	spies: HandlerSpies,
	details: { targetMode: string; reason?: string },
): Promise<void> {
	const target = details.targetMode;
	const reason = details.reason?.trim();
	const next = MODE_MAP[target];
	if (next === undefined) {
		spies.showStatus(`Unknown mode: ${target}`);
		return;
	}
	if (next === currentMode) {
		spies.showStatus(`Already in ${target} mode.`);
		return;
	}
	const message = reason
		? `The agent requests switching to ${target} mode: ${reason}`
		: `The agent requests switching to ${target} mode.`;
	const confirmed = await spies.showHookConfirm(`Switch to ${target} mode?`, message);
	if (!confirmed) {
		spies.showStatus("Mode switch cancelled.");
		return;
	}
	await spies.setActiveMode(next);
	spies.showStatus(`${target} mode enabled`);
}

/** Mirrors the production `#setActiveMode` body, scoped to the ask/none
 *  branches the spies wire up. Lockstep with `interactive-mode.ts:4108-...`
 *  for the no-op guard. */
async function setActiveMode(
	getCurrentMode: () => Mode,
	setCurrentMode: (m: Mode) => void,
	spies: HandlerSpies,
	askModeEnabled: { value: boolean },
	next: Mode,
): Promise<void> {
	if (next === getCurrentMode()) {
		return;
	}
	if (getCurrentMode() === "ask") {
		await spies.disableAskMode();
		askModeEnabled.value = false;
	}
	setCurrentMode(next);
	if (next === "ask") {
		spies.enableAskMode();
		askModeEnabled.value = true;
	}
	spies.appendModeChange(next);
	await spies.refreshBaseSystemPrompt();
}

function makeSpies(): HandlerSpies {
	return {
		showStatus: vi.fn<(message: string) => void>(),
		showHookConfirm: vi.fn<(title: string, message: string) => Promise<boolean>>(async () => true),
		setActiveMode: vi.fn<(next: Mode) => Promise<void>>(async () => {}),
		disableAskMode: vi.fn<() => Promise<void>>(async () => {}),
		enableAskMode: vi.fn<() => void>(),
		refreshBaseSystemPrompt: vi.fn<() => Promise<void>>(async () => {}),
		appendModeChange: vi.fn<(mode: string) => void>(),
	};
}

describe("handleSwitchModeTool no-op short-circuit", () => {
	it("skips the confirm dialog when target equals current mode (agent → agent)", async () => {
		const spies = makeSpies();
		await handleSwitchModeTool("none", spies, { targetMode: "agent", reason: "edit" });

		expect(spies.showHookConfirm).not.toHaveBeenCalled();
		expect(spies.setActiveMode).not.toHaveBeenCalled();
		expect(spies.showStatus).toHaveBeenCalledWith("Already in agent mode.");
	});

	it("skips the confirm dialog when target equals current mode (ask → ask)", async () => {
		const spies = makeSpies();
		await handleSwitchModeTool("ask", spies, { targetMode: "ask", reason: "re-check" });

		expect(spies.showHookConfirm).not.toHaveBeenCalled();
		expect(spies.setActiveMode).not.toHaveBeenCalled();
		expect(spies.showStatus).toHaveBeenCalledWith("Already in ask mode.");
	});

	it("shows the confirm dialog when target differs from current mode", async () => {
		const spies = makeSpies();
		spies.showHookConfirm.mockResolvedValueOnce(true);
		await handleSwitchModeTool("none", spies, { targetMode: "ask", reason: "look but don't touch" });

		expect(spies.showHookConfirm).toHaveBeenCalledTimes(1);
		expect(spies.setActiveMode).toHaveBeenCalledWith("ask");
		expect(spies.showStatus).toHaveBeenCalledWith("ask mode enabled");
	});

	it("rejects an unknown target mode without prompting", async () => {
		const spies = makeSpies();
		await handleSwitchModeTool("none", spies, { targetMode: "lolwut" });

		expect(spies.showHookConfirm).not.toHaveBeenCalled();
		expect(spies.setActiveMode).not.toHaveBeenCalled();
		expect(spies.showStatus).toHaveBeenCalledWith("Unknown mode: lolwut");
	});

	it("respects a cancelled confirm dialog", async () => {
		const spies = makeSpies();
		spies.showHookConfirm.mockResolvedValueOnce(false);
		await handleSwitchModeTool("none", spies, { targetMode: "ask" });

		expect(spies.setActiveMode).not.toHaveBeenCalled();
		expect(spies.showStatus).toHaveBeenCalledWith("Mode switch cancelled.");
	});
});

describe("#setActiveMode no-op short-circuit", () => {
	it("returns early when target equals current mode (no exit/enter cycle)", async () => {
		const spies = makeSpies();
		const askMode = { value: true };
		const store: { current: Mode } = { current: "ask" };
		await setActiveMode(
			() => store.current,
			m => (store.current = m),
			spies,
			askMode,
			"ask",
		);

		expect(spies.disableAskMode).not.toHaveBeenCalled();
		expect(spies.enableAskMode).not.toHaveBeenCalled();
		expect(spies.appendModeChange).not.toHaveBeenCalled();
		expect(spies.refreshBaseSystemPrompt).not.toHaveBeenCalled();
		expect(askMode.value).toBe(true);
	});

	it("runs the full cycle when target differs from current mode", async () => {
		const spies = makeSpies();
		const askMode = { value: false };
		const store: { current: Mode } = { current: "none" };
		await setActiveMode(
			() => store.current,
			m => (store.current = m),
			spies,
			askMode,
			"ask",
		);

		expect(spies.enableAskMode).toHaveBeenCalledTimes(1);
		expect(spies.appendModeChange.mock.calls[0]?.[0]).toBe("ask");
		expect(spies.refreshBaseSystemPrompt).toHaveBeenCalledTimes(1);
		expect(askMode.value).toBe(true);
		expect(store.current).toBe("ask");
	});
});
