import { describe, expect, it } from "bun:test";
import { toolWireSchema } from "@oh-my-pi/pi-ai/utils/schema/wire";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { SwitchModeTool } from "@oh-my-pi/pi-coding-agent/tools/switch-mode";

function createSession(): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
	};
}

function getText(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content.find(part => part.type === "text")?.text ?? "";
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

	it("returns details with targetMode and reason for mode=agent", async () => {
		const tool = new SwitchModeTool(createSession());
		const result = await tool.execute("call-1", { mode: "agent", reason: "need to write files" });
		expect(getText(result)).toContain("agent");
		expect(result.details).toEqual({ targetMode: "agent", reason: "need to write files" });
	});

	it("returns details for mode=ask without a reason", async () => {
		const tool = new SwitchModeTool(createSession());
		const result = await tool.execute("call-2", { mode: "ask" });
		expect(result.details).toEqual({ targetMode: "ask", reason: undefined });
	});

	it("does NOT mutate mode state itself — the event-controller reacts post-execution", async () => {
		// The tool returns details only; it must not call any session mutator.
		// The event-controller's #handleToolExecutionEnd is the single reaction
		// point, mirroring the pre-existing exit_plan_mode pattern.
		const tool = new SwitchModeTool(createSession());
		const result = await tool.execute("call-3", { mode: "agent", reason: "test" });
		// Contract: details are returned, content is non-empty, no side effect.
		expect(result.details).toEqual({ targetMode: "agent", reason: "test" });
		expect(result.content.length).toBeGreaterThan(0);
	});
});
