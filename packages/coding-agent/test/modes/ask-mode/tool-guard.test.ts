import { afterEach, describe, expect, it } from "bun:test";
import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core";
import { Type } from "@oh-my-pi/pi-ai";
import { isReadOnlyBashCommand } from "@oh-my-pi/pi-coding-agent/modes/ask-mode/bash-readonly";
import type { AskModeState } from "@oh-my-pi/pi-coding-agent/modes/ask-mode/state";
import { type AskModeValidator, wrapToolWithAskModeGuard } from "@oh-my-pi/pi-coding-agent/modes/ask-mode/tool-guard";

// ── Minimal tool stub ─────────────────────────────────────────────────────────

function makeToolStub(name: string): AgentTool<any, any, any> {
	const stub: AgentTool<any, any, any> = {
		name,
		label: `stub:${name}`,
		description: `stub:${name}`,
		parameters: Type.Object({}),
		execute: async (_id, _params, _signal, _onUpdate, _ctx): Promise<AgentToolResult> => ({
			content: [{ type: "text", text: `${name} executed` }],
		}),
	};
	return stub;
}

function textOf(result: AgentToolResult): string {
	const parts = result.content.filter(c => c.type === "text");
	return parts.map(c => (c as { type: "text"; text: string }).text).join("");
}

// ── Ask-mode state helpers ────────────────────────────────────────────────────

const askOn: AskModeState = { enabled: true };
const askOff: AskModeState = { enabled: false };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("wrapToolWithAskModeGuard", () => {
	afterEach(() => {
		// No module mocks used — nothing to restore
	});

	describe("ask mode OFF", () => {
		it("runs any tool unconditionally when ask mode is off", async () => {
			const tool = makeToolStub("bash");
			const wrapped = wrapToolWithAskModeGuard(tool, () => askOff);
			const result = await wrapped.execute("id", { command: "rm -rf /" });
			expect(textOf(result)).toBe("bash executed");
		});

		it("runs a non-readonly tool unconditionally when ask mode is off", async () => {
			const tool = makeToolStub("edit");
			const wrapped = wrapToolWithAskModeGuard(tool, () => askOff);
			const result = await wrapped.execute("id", {});
			expect(textOf(result)).toBe("edit executed");
		});
	});

	describe("ask mode ON — static readonly tools", () => {
		it("allows read tool through without validators", async () => {
			const tool = makeToolStub("read");
			const wrapped = wrapToolWithAskModeGuard(tool, () => askOn);
			const result = await wrapped.execute("id", {});
			expect(textOf(result)).toBe("read executed");
		});

		it("blocks a non-readonly tool that has no validator", async () => {
			const tool = makeToolStub("edit");
			const wrapped = wrapToolWithAskModeGuard(tool, () => askOn);
			const result = await wrapped.execute("id", {});
			expect(textOf(result)).toContain("Cannot use write tools in Ask mode");
		});
	});

	describe("ask mode ON — bash with validator", () => {
		function makeBashValidator(): AskModeValidator {
			return (params: unknown) => {
				const command =
					typeof params === "object" && params !== null && "command" in params
						? String((params as Record<string, unknown>).command)
						: "";
				return isReadOnlyBashCommand(command);
			};
		}

		it("allows a read-only bash command", async () => {
			const tool = makeToolStub("bash");
			const validators = new Map<string, AskModeValidator>([["bash", makeBashValidator()]]);
			const wrapped = wrapToolWithAskModeGuard(tool, () => askOn, validators);
			const result = await wrapped.execute("id", { command: "ls -la" });
			expect(textOf(result)).toBe("bash executed");
		});

		it("blocks a mutating bash command and includes the reason", async () => {
			const tool = makeToolStub("bash");
			const validators = new Map<string, AskModeValidator>([["bash", makeBashValidator()]]);
			const wrapped = wrapToolWithAskModeGuard(tool, () => askOn, validators);
			const result = await wrapped.execute("id", { command: "rm -rf /" });
			const text = textOf(result);
			expect(text).toContain("Cannot use bash in Ask mode");
			expect(text).toContain("rm");
			expect(text).toContain("Switch to Agent mode");
		});

		it("blocks bash when ask mode is on but ask mode turns off mid-session", async () => {
			let state: AskModeState = askOn;
			const tool = makeToolStub("bash");
			const validators = new Map<string, AskModeValidator>([["bash", makeBashValidator()]]);
			const wrapped = wrapToolWithAskModeGuard(tool, () => state, validators);

			// blocked when ask mode is on
			const blocked = await wrapped.execute("id", { command: "rm foo" });
			expect(textOf(blocked)).toContain("Cannot use bash in Ask mode");

			// allowed after ask mode turns off
			state = askOff;
			const allowed = await wrapped.execute("id", { command: "rm foo" });
			expect(textOf(allowed)).toBe("bash executed");
		});
	});

	describe("ask mode ON — undefined state", () => {
		it("allows execution when state is undefined (ask mode not initialised)", async () => {
			const tool = makeToolStub("edit");
			const wrapped = wrapToolWithAskModeGuard(tool, () => undefined);
			const result = await wrapped.execute("id", {});
			expect(textOf(result)).toBe("edit executed");
		});
	});
});
