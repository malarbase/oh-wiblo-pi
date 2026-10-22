import { describe, expect, it } from "bun:test";
import { toolWireSchema } from "@oh-my-pi/pi-ai/utils/schema/wire";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ModeSnapshot, ModeSwitchOutcome, SessionMode } from "@oh-my-pi/pi-coding-agent/modes/mode-state";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { SwitchModeTool } from "@oh-my-pi/pi-coding-agent/tools/switch-mode";

function createSession(overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
		...overrides,
	};
}

function getText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content.find(part => part.type === "text")?.text ?? "";
}

function snapshot(mode: SessionMode, paused = false): ModeSnapshot {
	return {
		mode,
		planPaused: mode === "plan" && paused,
		goalPaused: mode === "goal" && paused,
	};
}

describe("SwitchModeTool", () => {
	it("is named switch_mode with read approval", () => {
		const tool = new SwitchModeTool(createSession());
		expect(tool.name).toBe("switch_mode");
		expect(tool.approval).toBe("read");
	});

	it("requires mode in schema, reason is optional", () => {
		const tool = new SwitchModeTool(createSession());
		const wire = toolWireSchema(tool) as {
			required?: string[];
			properties?: { mode?: { enum?: string[] }; reason?: unknown };
		};
		expect(wire.required).toEqual(["mode"]);
		expect(wire.properties?.mode?.enum).toEqual(["agent", "ask", "plan", "debug", "goal"]);
		expect(wire.properties?.reason).toBeDefined();
	});

	it("asks the session to switch and reports the outcome", async () => {
		const calls: Array<{ target: SessionMode; reason?: string }> = [];
		const outcome: ModeSwitchOutcome = {
			status: "switched",
			mode: "plan",
			message: "Harness mode: plan. Switched to plan mode.",
		};
		const tool = new SwitchModeTool(
			createSession({
				getModeSnapshot: () => snapshot("none"),
				requestModeSwitch: async (target, reason) => {
					calls.push({ target, reason });
					return outcome;
				},
			}),
		);
		const result = await tool.execute("call-1", { mode: "plan", reason: "need to draft a plan" });
		expect(calls).toEqual([{ target: "plan", reason: "need to draft a plan" }]);
		expect(getText(result)).toBe("Harness mode: plan. Switched to plan mode.");
		expect(result.details).toEqual({
			targetMode: "plan",
			reason: "need to draft a plan",
			currentMode: "plan",
			outcome: "switched",
		});
	});

	it("does not ask the user when the harness is already in the target mode", async () => {
		let asked = 0;
		const tool = new SwitchModeTool(
			createSession({
				getModeSnapshot: () => snapshot("plan"),
				requestModeSwitch: async () => {
					asked++;
					return { status: "switched", mode: "plan", message: "unused" };
				},
			}),
		);
		const result = await tool.execute("call-2", { mode: "plan" });
		expect(asked).toBe(0);
		expect(getText(result)).toBe("Harness mode: plan. Already in plan mode — no switch performed.");
		expect(result.details).toEqual({
			targetMode: "plan",
			reason: undefined,
			currentMode: "plan",
			outcome: "already",
		});
	});

	it("asks for a switch when the plan is paused — that resumes it", async () => {
		let asked = 0;
		const tool = new SwitchModeTool(
			createSession({
				getModeSnapshot: () => snapshot("plan", true),
				requestModeSwitch: async () => {
					asked++;
					return { status: "switched", mode: "plan", message: "Harness mode: plan. Switched to plan mode." };
				},
			}),
		);
		const result = await tool.execute("call-3", { mode: "plan" });
		expect(asked).toBe(1);
		expect(result.details?.outcome).toBe("switched");
	});

	it("reports the mode the harness ended up in when the user declines", async () => {
		const tool = new SwitchModeTool(
			createSession({
				getModeSnapshot: () => snapshot("none"),
				requestModeSwitch: async () => ({
					status: "cancelled",
					mode: "none",
					message:
						"Harness mode: agent. The user declined the switch to plan mode — the harness is still in agent mode.",
				}),
			}),
		);
		const result = await tool.execute("call-4", { mode: "plan" });
		expect(getText(result)).toContain("the harness is still in agent mode");
		expect(result.details).toEqual({
			targetMode: "plan",
			reason: undefined,
			currentMode: "none",
			outcome: "cancelled",
		});
	});

	it("reports an unavailable switch in a session that cannot ask the user", async () => {
		const tool = new SwitchModeTool(createSession({ getModeSnapshot: () => snapshot("none") }));
		const result = await tool.execute("call-5", { mode: "ask" });
		expect(getText(result)).toContain("needs an interactive session");
		expect(result.details).toEqual({
			targetMode: "ask",
			reason: undefined,
			currentMode: "none",
			outcome: "unavailable",
		});
		expect(result.isError).toBe(true);
	});

	it("rejects a mode it does not know", async () => {
		const tool = new SwitchModeTool(createSession({ getModeSnapshot: () => snapshot("none") }));
		const result = await tool.execute("call-6", { mode: "lolwut" as never });
		expect(result.isError).toBe(true);
		expect(getText(result)).toContain("Unknown mode");
	});
});
