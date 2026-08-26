import { describe, expect, it } from "bun:test";
import { enforceAskModeGuard } from "../../../src/modes/ask-mode/ask-mode-guard";
import type { AskModeState } from "../../../src/modes/ask-mode/state";
import type { ToolSession } from "../../../src/tools";

interface SessionOverrides {
	askMode?: AskModeState;
}

function makeSession(overrides: SessionOverrides): ToolSession {
	return {
		cwd: "/repo",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: {},
		getAskModeState: () => overrides.askMode,
	} as unknown as ToolSession;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter(c => c.type === "text")
		.map(c => (c as { type: "text"; text: string }).text)
		.join("");
}

const askOn: AskModeState = { enabled: true };
const askOff: AskModeState = { enabled: false };

describe("enforceAskModeGuard", () => {
	describe("ask mode OFF / undefined", () => {
		it("returns null (allow) when ask mode is off", () => {
			const session = makeSession({ askMode: askOff });
			expect(enforceAskModeGuard(session, "bash", { command: "rm -rf /" })).toBeNull();
		});

		it("returns null (allow) when ask mode state is undefined (uninitialized)", () => {
			const session = makeSession({});
			expect(enforceAskModeGuard(session, "edit", {})).toBeNull();
		});
	});

	describe("ask mode ON — static readonly tools", () => {
		it("allows the read tool", () => {
			const session = makeSession({ askMode: askOn });
			expect(enforceAskModeGuard(session, "read", {})).toBeNull();
		});

		it("allows the lsp tool", () => {
			const session = makeSession({ askMode: askOn });
			expect(enforceAskModeGuard(session, "lsp", {})).toBeNull();
		});

		it("allows grep / find / ast_grep (static allowlist)", () => {
			const session = makeSession({ askMode: askOn });
			expect(enforceAskModeGuard(session, "grep", {})).toBeNull();
			expect(enforceAskModeGuard(session, "find", {})).toBeNull();
			expect(enforceAskModeGuard(session, "ast_grep", {})).toBeNull();
		});
	});

	describe("ask mode ON — bash classifier", () => {
		it("allows a read-only bash command (ls)", () => {
			const session = makeSession({ askMode: askOn });
			expect(enforceAskModeGuard(session, "bash", { command: "ls -la" })).toBeNull();
		});

		it("allows git status / git log", () => {
			const session = makeSession({ askMode: askOn });
			expect(enforceAskModeGuard(session, "bash", { command: "git status" })).toBeNull();
			expect(enforceAskModeGuard(session, "bash", { command: "git log --oneline -5" })).toBeNull();
		});

		it("blocks `rm -rf` and mentions switch_mode in the reason", () => {
			const session = makeSession({ askMode: askOn });
			const block = enforceAskModeGuard(session, "bash", { command: "rm -rf /" });
			expect(block).not.toBeNull();
			const text = textOf(block!);
			expect(text).toContain("Cannot use bash in Ask mode");
			expect(text).toContain("switch_mode");
		});

		it("blocks output redirection (mutating)", () => {
			const session = makeSession({ askMode: askOn });
			const block = enforceAskModeGuard(session, "bash", { command: "echo hi > /etc/foo" });
			expect(block).not.toBeNull();
			expect(textOf(block!)).toContain("switch_mode");
		});

		it("handles missing `command` field gracefully (blocks)", () => {
			const session = makeSession({ askMode: askOn });
			const block = enforceAskModeGuard(session, "bash", {});
			expect(block).not.toBeNull();
			expect(textOf(block!)).toContain("switch_mode");
		});
	});

	describe("ask mode ON — non-readonly write tools", () => {
		it("blocks the write tool and mentions switch_mode", () => {
			const session = makeSession({ askMode: askOn });
			const block = enforceAskModeGuard(session, "write", { path: "foo.txt", content: "x" });
			expect(block).not.toBeNull();
			const text = textOf(block!);
			expect(text).toContain("Cannot use write in Ask mode");
			expect(text).toContain("switch_mode");
		});

		it("blocks the edit tool", () => {
			const session = makeSession({ askMode: askOn });
			const block = enforceAskModeGuard(session, "edit", { path: "foo.ts" });
			expect(block).not.toBeNull();
			expect(textOf(block!)).toContain("switch_mode");
		});

		it("blocks ast_edit", () => {
			const session = makeSession({ askMode: askOn });
			const block = enforceAskModeGuard(session, "ast_edit", {});
			expect(block).not.toBeNull();
		});
	});

	describe("rebase-survival contract", () => {
		// The guard must read live state via the accessor on every call — not
		// cache at registration time. This is what makes toggling ask mode
		// take effect immediately and what survived the rebases that killed the
		// old registration-time wrapper.
		it("reflects a mid-session ask-mode toggle without re-wrapping", () => {
			let state: AskModeState | undefined = askOn;
			const session = {
				cwd: "/repo",
				hasUI: false,
				getSessionFile: () => null,
				getSessionSpawns: () => "*",
				settings: {},
				getAskModeState: () => state,
			} as unknown as ToolSession;

			// Blocked while ask mode is on
			const block = enforceAskModeGuard(session, "bash", { command: "rm foo" });
			expect(block).not.toBeNull();

			// Allowed after ask mode turns off
			state = askOff;
			expect(enforceAskModeGuard(session, "bash", { command: "rm foo" })).toBeNull();
		});
	});
});
