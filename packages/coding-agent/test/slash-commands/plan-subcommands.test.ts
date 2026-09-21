import { afterEach, describe, expect, it, vi } from "bun:test";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { executeBuiltinSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";

function createRuntime() {
	const handlePlanModeCommand = vi.fn().mockResolvedValue(undefined);
	const handlePlanRunCommand = vi.fn().mockResolvedValue(undefined);
	const handlePlanListCommand = vi.fn().mockResolvedValue(undefined);
	const handlePlanLoadCommand = vi.fn().mockResolvedValue(undefined);
	const setText = vi.fn();
	return {
		handlePlanModeCommand,
		handlePlanRunCommand,
		handlePlanListCommand,
		handlePlanLoadCommand,
		setText,
		runtime: {
			ctx: {
				editor: { setText } as unknown as InteractiveModeContext["editor"],
				handlePlanModeCommand,
				handlePlanRunCommand,
				handlePlanListCommand,
				handlePlanLoadCommand,
			} as unknown as InteractiveModeContext,
			handleBackgroundCommand: vi.fn(),
		},
	};
}

describe("/plan slash command", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("no args → calls handlePlanModeCommand(undefined)", async () => {
		const h = createRuntime();
		const handled = await executeBuiltinSlashCommand("/plan", h.runtime);
		expect(handled).toBe(true);
		expect(h.handlePlanModeCommand).toHaveBeenCalledWith(undefined);
		expect(h.handlePlanRunCommand).not.toHaveBeenCalled();
		expect(h.handlePlanListCommand).not.toHaveBeenCalled();
		expect(h.setText).toHaveBeenCalledWith("");
	});

	it("non-subcommand args → calls handlePlanModeCommand with full args string", async () => {
		const h = createRuntime();
		const handled = await executeBuiltinSlashCommand("/plan some initial prompt", h.runtime);
		expect(handled).toBe(true);
		expect(h.handlePlanModeCommand).toHaveBeenCalledWith("some initial prompt");
		expect(h.handlePlanRunCommand).not.toHaveBeenCalled();
		expect(h.handlePlanListCommand).not.toHaveBeenCalled();
		expect(h.setText).toHaveBeenCalledWith("");
	});

	it("/plan run FOO_PLAN → calls handlePlanRunCommand('FOO_PLAN')", async () => {
		const h = createRuntime();
		const handled = await executeBuiltinSlashCommand("/plan run FOO_PLAN", h.runtime);
		expect(handled).toBe(true);
		expect(h.handlePlanRunCommand).toHaveBeenCalledWith("FOO_PLAN");
		expect(h.handlePlanModeCommand).not.toHaveBeenCalled();
		expect(h.handlePlanListCommand).not.toHaveBeenCalled();
		expect(h.setText).toHaveBeenCalledWith("");
	});

	it("/plan run FOO_PLAN --keep → calls handlePlanRunCommand('FOO_PLAN --keep')", async () => {
		const h = createRuntime();
		const handled = await executeBuiltinSlashCommand("/plan run FOO_PLAN --keep", h.runtime);
		expect(handled).toBe(true);
		expect(h.handlePlanRunCommand).toHaveBeenCalledWith("FOO_PLAN --keep");
		expect(h.handlePlanModeCommand).not.toHaveBeenCalled();
		expect(h.handlePlanListCommand).not.toHaveBeenCalled();
		expect(h.setText).toHaveBeenCalledWith("");
	});

	it("/plan list → calls handlePlanListCommand()", async () => {
		const h = createRuntime();
		const handled = await executeBuiltinSlashCommand("/plan list", h.runtime);
		expect(handled).toBe(true);
		expect(h.handlePlanListCommand).toHaveBeenCalledTimes(1);
		expect(h.handlePlanModeCommand).not.toHaveBeenCalled();
		expect(h.handlePlanRunCommand).not.toHaveBeenCalled();
		expect(h.setText).toHaveBeenCalledWith("");
	});

	it("/plan load FOO_PLAN → calls handlePlanLoadCommand('FOO_PLAN')", async () => {
		const h = createRuntime();
		const handled = await executeBuiltinSlashCommand("/plan load FOO_PLAN", h.runtime);
		expect(handled).toBe(true);
		expect(h.handlePlanLoadCommand).toHaveBeenCalledWith("FOO_PLAN");
		expect(h.handlePlanModeCommand).not.toHaveBeenCalled();
		expect(h.handlePlanRunCommand).not.toHaveBeenCalled();
		expect(h.handlePlanListCommand).not.toHaveBeenCalled();
		expect(h.setText).toHaveBeenCalledWith("");
	});

	it("/plan load FOO_PLAN add an extra step → calls handlePlanLoadCommand with full trailing text", async () => {
		const h = createRuntime();
		const handled = await executeBuiltinSlashCommand("/plan load FOO_PLAN add an extra step", h.runtime);
		expect(handled).toBe(true);
		expect(h.handlePlanLoadCommand).toHaveBeenCalledWith("FOO_PLAN add an extra step");
		expect(h.handlePlanModeCommand).not.toHaveBeenCalled();
		expect(h.handlePlanRunCommand).not.toHaveBeenCalled();
		expect(h.handlePlanListCommand).not.toHaveBeenCalled();
		expect(h.setText).toHaveBeenCalledWith("");
	});

	it("/plan load (no name) → calls handlePlanLoadCommand('')", async () => {
		const h = createRuntime();
		const handled = await executeBuiltinSlashCommand("/plan load", h.runtime);
		expect(handled).toBe(true);
		expect(h.handlePlanLoadCommand).toHaveBeenCalledWith("");
		expect(h.handlePlanModeCommand).not.toHaveBeenCalled();
		expect(h.handlePlanRunCommand).not.toHaveBeenCalled();
		expect(h.handlePlanListCommand).not.toHaveBeenCalled();
		expect(h.setText).toHaveBeenCalledWith("");
	});
});
