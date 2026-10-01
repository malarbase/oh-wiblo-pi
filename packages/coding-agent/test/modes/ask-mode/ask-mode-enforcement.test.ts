import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createTools, type Tool, type ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { removeWithRetries } from "@oh-my-pi/pi-utils";

/**
 * Ask-mode enforcement through the real `createTools` pipeline: a ToolSession
 * with ask mode enabled, the real built-in tools, and observable side effects
 * (files created / commands spawned) to prove the guard — not a stub — is what
 * refuses mutating calls. Complements the isolated wrapper tests in
 * tool-guard.test.ts and the policy-unit tests in ask-mode-guard.test.ts.
 */

function createAskSession(cwd: string, askModeEnabled: boolean): ToolSession {
	return {
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated({ "tools.xdev": false }),
		getAskModeState: () => (askModeEnabled ? { enabled: true } : undefined),
	};
}

function textOf(result: AgentToolResult): string {
	return result.content
		.filter(c => c.type === "text")
		.map(c => (c as { type: "text"; text: string }).text)
		.join("");
}

async function toolFrom(tools: Tool[], name: string): Promise<Tool> {
	const tool = tools.find(entry => entry.name === name);
	expect(tool).toBeDefined();
	return tool as Tool;
}

const tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ask-mode-enforce-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) await removeWithRetries(dir);
});

describe("ask mode enforcement via createTools", () => {
	it("refuses write with the guard's block result and creates no file", async () => {
		const cwd = await makeTempDir();
		const write = await toolFrom(await createTools(createAskSession(cwd, true), ["write"]), "write");

		const target = path.join(cwd, "should-not-exist.txt");
		const result = await write.execute("write-ask", { path: target, content: "hello" });

		const text = textOf(result);
		expect(text).toContain("Cannot use write in Ask mode");
		expect(text).toContain("switch_mode");
		expect(await Bun.file(target).exists()).toBe(false);
	});

	it("refuses a mutating bash command and never spawns it", async () => {
		const cwd = await makeTempDir();
		const bash = await toolFrom(await createTools(createAskSession(cwd, true), ["bash"]), "bash");

		const marker = path.join(cwd, "marker.txt");
		const result = await bash.execute("bash-ask", { command: `touch ${marker}` });

		const text = textOf(result);
		expect(text).toContain("Cannot use bash in Ask mode");
		expect(text).toContain("switch_mode");
		expect(await Bun.file(marker).exists()).toBe(false);
	});

	it("runs a read-only bash command in ask mode", async () => {
		const cwd = await makeTempDir();
		await Bun.write(path.join(cwd, "visible-marker.txt"), "x");
		const bash = await toolFrom(await createTools(createAskSession(cwd, true), ["bash"]), "bash");

		const result = await bash.execute("bash-ls", { command: "ls", cwd });

		const text = textOf(result);
		expect(text).not.toContain("Ask mode");
		expect(text).toContain("visible-marker.txt");
	});

	it("refuses ast_edit with the guard's block result and leaves the file untouched", async () => {
		const cwd = await makeTempDir();
		const filePath = path.join(cwd, "code.ts");
		await Bun.write(filePath, "const x = 1;\n");
		const astEdit = await toolFrom(await createTools(createAskSession(cwd, true), ["ast_edit"]), "ast_edit");

		const result = await astEdit.execute("ast-ask", { paths: [filePath], ops: [{ pat: "$X", out: "$X" }] });

		const text = textOf(result);
		expect(text).toContain("Cannot use ast_edit in Ask mode");
		expect(text).toContain("switch_mode");
		expect(await Bun.file(filePath).text()).toBe("const x = 1;\n");
	});

	it("keeps the switch_mode escape hatch callable in ask mode", async () => {
		const cwd = await makeTempDir();
		const switchMode = await toolFrom(await createTools(createAskSession(cwd, true), ["switch_mode"]), "switch_mode");

		const result = await switchMode.execute("switch-ask", { mode: "agent", reason: "make the edit" });

		const text = textOf(result);
		expect(text).not.toContain("Ask mode");
		expect(text).toContain("Requested switch to agent mode");
	});

	it("lets write through when ask mode is off", async () => {
		const cwd = await makeTempDir();
		const write = await toolFrom(await createTools(createAskSession(cwd, false), ["write"]), "write");

		const target = path.join(cwd, "allowed.txt");
		const result = await write.execute("write-go", { path: target, content: "hi" });

		expect(result.isError).toBeUndefined();
		expect(await Bun.file(target).text()).toBe("hi");
	});
});
