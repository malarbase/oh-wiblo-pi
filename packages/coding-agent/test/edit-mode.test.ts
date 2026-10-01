import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type EditMode } from "@oh-my-pi/pi-tui/tools/edit";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { EditTool } from "@oh-my-pi/pi-coding-agent/edit";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { type EditModeSessionLike, resolveEditMode } from "@oh-my-pi/pi-coding-agent/utils/edit-mode";
import { removeWithRetries } from "@oh-my-pi/pi-utils";

const originalEditVariant = Bun.env.PI_EDIT_VARIANT;
const originalStrictEditMode = Bun.env.PI_STRICT_EDIT_MODE;

function restoreEnv(): void {
	if (originalEditVariant === undefined) {
		delete Bun.env.PI_EDIT_VARIANT;
	} else {
		Bun.env.PI_EDIT_VARIANT = originalEditVariant;
	}
	if (originalStrictEditMode === undefined) {
		delete Bun.env.PI_STRICT_EDIT_MODE;
	} else {
		Bun.env.PI_STRICT_EDIT_MODE = originalStrictEditMode;
	}
}

function createSession(args: {
	activeModel?: string;
	modelVariant?: EditMode | null;
	settingsMode?: EditMode;
}): EditModeSessionLike {
	return {
		getActiveModelString: () => args.activeModel,
		settings: {
			get: () => args.settingsMode ?? "hashline",
			getEditVariantForModel: () => args.modelVariant ?? null,
		},
	};
}

describe("resolveEditMode", () => {
	beforeEach(() => {
		delete Bun.env.PI_EDIT_VARIANT;
		delete Bun.env.PI_STRICT_EDIT_MODE;
	});

	afterEach(() => {
		restoreEnv();
	});

	test("falls back from hashline to replace for Kimi models", () => {
		delete Bun.env.PI_EDIT_VARIANT;

		expect(resolveEditMode(createSession({ activeModel: "openrouter/moonshotai/Kimi-K2-Instruct" }))).toBe("replace");
	});

	test("selects the fork's mimo mode for MiMo models", () => {
		delete Bun.env.PI_EDIT_VARIANT;

		expect(resolveEditMode(createSession({ activeModel: "xiaomi/MiMo-V2.5-Pro" }))).toBe("mimo");
	});

	test("falls back from hashline to replace for DeepSeek models", () => {
		delete Bun.env.PI_EDIT_VARIANT;

		expect(resolveEditMode(createSession({ activeModel: "tensormesh/deepseek-ai/DeepSeek-V4-Flash" }))).toBe(
			"replace",
		);
		expect(resolveEditMode(createSession({ activeModel: "deepseek/deepseek-chat" }))).toBe("replace");
		expect(resolveEditMode(createSession({ activeModel: "deepseek/deepseek-reasoner" }))).toBe("replace");
	});

	test("falls back from hashline to replace for Step 3.7 Flash models", () => {
		delete Bun.env.PI_EDIT_VARIANT;

		expect(resolveEditMode(createSession({ activeModel: "kilo/stepfun/step-3.7-flash:free" }))).toBe("replace");
	});

	test("uses replace for Codex Spark without excluding other Codex models", () => {
		expect(resolveEditMode(createSession({ activeModel: "openai-codex/gpt-5.3-codex-spark" }))).toBe("replace");
		expect(resolveEditMode(createSession({ activeModel: "openai-codex/gpt-5.3-codex" }))).toBe("hashline");
	});

	test("uses replace across MiniMax model families", () => {
		expect(resolveEditMode(createSession({ activeModel: "openrouter/minimax/minimax-m1" }))).toBe("replace");
		expect(resolveEditMode(createSession({ activeModel: "minimax/MiniMax-M2.5" }))).toBe("replace");
		expect(resolveEditMode(createSession({ activeModel: "minimax/MiniMax-M3" }))).toBe("replace");
	});

	test("excludes GLM 5.3 Flash without excluding other GLM revisions or families", () => {
		expect(resolveEditMode(createSession({ activeModel: "zai/glm-5.3-flash" }))).toBe("replace");
		expect(resolveEditMode(createSession({ activeModel: "zai/glm-5.3" }))).toBe("hashline");
		expect(resolveEditMode(createSession({ activeModel: "zai/glm-4.7-flash" }))).toBe("hashline");
	});

	test("does not exclude non-Kimi Moonshot models", () => {
		delete Bun.env.PI_EDIT_VARIANT;

		expect(resolveEditMode(createSession({ activeModel: "moonshot/moonshot-v1-128k" }))).toBe("hashline");
	});

	test("keeps explicit model variants ahead of the Kimi fallback", () => {
		delete Bun.env.PI_EDIT_VARIANT;

		expect(
			resolveEditMode(
				createSession({ activeModel: "openrouter/moonshotai/Kimi-K2-Instruct", modelVariant: "hashline" }),
			),
		).toBe("hashline");
	});

	test("keeps PI_EDIT_VARIANT ahead of the Kimi fallback", () => {
		Bun.env.PI_EDIT_VARIANT = "hashline";

		expect(resolveEditMode(createSession({ activeModel: "openrouter/moonshotai/Kimi-K2-Instruct" }))).toBe(
			"hashline",
		);
	});

	test("only falls back when the resolved mode is hashline", () => {
		delete Bun.env.PI_EDIT_VARIANT;

		expect(
			resolveEditMode(
				createSession({ activeModel: "openrouter/moonshotai/Kimi-K2-Instruct", settingsMode: "apply_patch" }),
			),
		).toBe("apply_patch");
	});

	test("keeps strict edit mode ahead of the Kimi fallback", () => {
		delete Bun.env.PI_EDIT_VARIANT;
		Bun.env.PI_STRICT_EDIT_MODE = "1";

		expect(resolveEditMode(createSession({ activeModel: "openrouter/moonshotai/Kimi-K2-Instruct" }))).toBe(
			"hashline",
		);
	});
});

describe("EditTool mimo mode", () => {
	let tempDir: string;

	beforeEach(async () => {
		delete Bun.env.PI_EDIT_VARIANT;
		delete Bun.env.PI_STRICT_EDIT_MODE;
		resetSettingsForTest();
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-edit-mimo-"));
	});

	afterEach(async () => {
		restoreEnv();
		resetSettingsForTest();
		await removeWithRetries(tempDir);
	});

	function makeToolSession(): ToolSession {
		return {
			cwd: tempDir,
			hasUI: false,
			enableLsp: false,
			getSessionFile: () => null,
			getSessionSpawns: () => "*",
			getArtifactsDir: () => null,
			getSessionId: () => null,
			getPlanModeState: () => undefined,
			settings: Settings.isolated({ "edit.mode": "mimo" }),
		} as unknown as ToolSession;
	}

	test("customFormat reports no lark grammar instead of asking the native binding", () => {
		const tool = new EditTool(makeToolSession());
		expect(tool.mode).toBe("mimo");
		// `editGrammar("mimo")` throws `Unknown edit mode: mimo`; the guard keeps
		// every reader of tool.customFormat (append-only-context fingerprinting
		// reads it on the first model call) safe for the default Xiaomi setup.
		expect(tool.customFormat).toBeUndefined();
	});

	test("openArgStream streams no native preview for mimo", () => {
		const tool = new EditTool(makeToolSession());
		const updates: unknown[] = [];
		// Without the guard, constructing the native EditSession with
		// mode mimo throws `Unknown edit mode: mimo`.
		const stream = tool.openArgStream({
			toolCallId: "mimo-stream",
			toolName: "edit",
			emit: update => updates.push(update),
		});
		stream.push('{"file_path":"sample.txt","old_');
		stream.end({ file_path: "sample.txt", old_string: "a", new_string: "b" });
		stream.cancel();
		expect(updates).toEqual([]);
	});

	test("execute applies a mimo edit through executeMimoSingle", async () => {
		const filePath = path.join(tempDir, "sample.txt");
		await Bun.write(filePath, "hello world\n");

		const tool = new EditTool(makeToolSession());
		const result = await tool.execute("mimo-edit", {
			file_path: filePath,
			old_string: "world",
			new_string: "there",
		});

		expect(result.isError).not.toBe(true);
		const text = result.content.map(part => (part.type === "text" ? part.text : "")).join("\n");
		// Only executeMimoSingle produces this success text — the native engines
		// (and their fallback in execute) cannot run mode mimo at all.
		expect(text).toBe("Edit applied successfully.");
		expect(await Bun.file(filePath).text()).toBe("hello there\n");
		expect(result.details).toMatchObject({
			path: filePath,
			oldText: "hello world\n",
			newText: "hello there\n",
		});
	});
});
