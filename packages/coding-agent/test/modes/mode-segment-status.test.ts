import { beforeAll, describe, expect, test } from "bun:test";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { SEGMENTS } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import type { SegmentContext } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/types";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

describe("modeSegment rendering", () => {
	beforeAll(async () => {
		resetSettingsForTest();
		await Settings.init({ inMemory: true });
		await initTheme();
	});

	function createDummyContext(overrides?: Partial<SegmentContext>): SegmentContext {
		return {
			session: {} as any,
			activeRepo: null,
			width: 100,
			options: {},
			compactThinkingLevel: false,
			askMode: null,
			debugMode: null,
			planMode: null,
			prewalk: null,
			loopMode: null,
			goalMode: null,
			vibeMode: null,
			collab: null,
			usageStats: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				orchestrationInput: 0,
				orchestrationOutput: 0,
				orchestrationCacheRead: 0,
				premiumRequests: 0,
				cost: 0,
				tokensPerSecond: null,
			},
			contextPercent: null,
			contextTokens: 0,
			contextWindow: 128000,
			autoCompactEnabled: true,
			compactionSpeculation: "idle",
			speculationBlinkOn: false,
			subagentCount: 0,
			activeMs: 0,
			git: { branch: null, status: null, pr: null },
			worktree: null,
			usage: null,
			...overrides,
		};
	}

	test("renders Ask mode when enabled", () => {
		const ctx = createDummyContext({ askMode: { enabled: true } });
		const result = SEGMENTS.mode.render(ctx);
		expect(result.visible).toBe(true);
		expect(result.content).toContain("Ask");
	});

	test("renders Debug mode when enabled", () => {
		const ctx = createDummyContext({ debugMode: { enabled: true } });
		const result = SEGMENTS.mode.render(ctx);
		expect(result.visible).toBe(true);
		expect(result.content).toContain("Debug");
	});

	test("renders Plan mode when enabled", () => {
		const ctx = createDummyContext({ planMode: { enabled: true, paused: false } });
		const result = SEGMENTS.mode.render(ctx);
		expect(result.visible).toBe(true);
		expect(result.content).toContain("Plan");
	});

	test("hides mode segment when no active mode", () => {
		const ctx = createDummyContext();
		const result = SEGMENTS.mode.render(ctx);
		expect(result.visible).toBe(false);
	});
});
