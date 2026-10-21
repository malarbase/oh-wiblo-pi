import { describe, expect, it, vi } from "bun:test";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { executeBuiltinSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";

function createRuntimeHarness() {
	const setText = vi.fn();
	const showStatus = vi.fn();
	const showWarning = vi.fn();
	const showDebugSelector = vi.fn();
	const handleDebugModeCommand = vi.fn();
	return {
		setText,
		showStatus,
		showWarning,
		showDebugSelector,
		handleDebugModeCommand,
		runtime: {
			ctx: {
				editor: { setText } as unknown as InteractiveModeContext["editor"],
				showStatus,
				showWarning,
				showDebugSelector,
				handleDebugModeCommand,
			} as unknown as InteractiveModeContext,
		},
	};
}

describe("/debug slash command", () => {
	it("toggles debug mode bare, keeps the selector reachable as a subcommand", async () => {
		const harness = createRuntimeHarness();

		expect(await executeBuiltinSlashCommand("/debug", harness.runtime)).toBe(true);
		expect(harness.handleDebugModeCommand).toHaveBeenCalledTimes(1);
		expect(harness.showDebugSelector).not.toHaveBeenCalled();
		expect(harness.setText).toHaveBeenCalledWith("");

		expect(await executeBuiltinSlashCommand("/debug tools", harness.runtime)).toBe(true);
		expect(harness.showDebugSelector).toHaveBeenCalledTimes(1);
		expect(harness.handleDebugModeCommand).toHaveBeenCalledTimes(1);
		expect(harness.setText).toHaveBeenLastCalledWith("");
	});

	it("rejects unknown arguments with a usage hint", async () => {
		const harness = createRuntimeHarness();

		expect(await executeBuiltinSlashCommand("/debug bogus", harness.runtime)).toBe(true);
		expect(harness.handleDebugModeCommand).not.toHaveBeenCalled();
		expect(harness.showDebugSelector).not.toHaveBeenCalled();
		expect(harness.showWarning).toHaveBeenCalledWith("Usage: /debug [tools]");
	});
});
