/**
 * Pi provider (.pi) entry-point wiring.
 *
 * `discovery/pi.ts` self-registers nine capabilities on import, but the only
 * trigger is the import list in `discovery/index.ts`. This test runs the real
 * entry point against a temp home/cwd and asserts the observable outcome: the
 * `pi` provider surfaces `.pi/settings.json`, `.pi/agent/skills/<name>/SKILL.md`,
 * and `.pi/commands/*.md` through the capability registry. It must fail if the
 * `./pi` import is dropped from the entry point.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { clearCache as clearFsCache } from "@oh-my-pi/pi-coding-agent/capability/fs";
import type { Settings } from "@oh-my-pi/pi-coding-agent/capability/settings";
import { settingsCapability } from "@oh-my-pi/pi-coding-agent/capability/settings";
import type { Skill } from "@oh-my-pi/pi-coding-agent/capability/skill";
import { skillCapability } from "@oh-my-pi/pi-coding-agent/capability/skill";
import type { SlashCommand } from "@oh-my-pi/pi-coding-agent/capability/slash-command";
import { slashCommandCapability } from "@oh-my-pi/pi-coding-agent/capability/slash-command";
import { resetSettingsForTest } from "@oh-my-pi/pi-coding-agent/config/settings";
// The real discovery entry point: importing it is what self-registers every
// provider, including ./pi.
import { getProviderInfo, loadCapability } from "@oh-my-pi/pi-coding-agent/discovery";
import { removeWithRetries } from "@oh-my-pi/pi-utils";

describe("pi discovery provider", () => {
	let tempDir = "";
	let originalHome: string | undefined;

	beforeEach(async () => {
		clearFsCache();
		resetSettingsForTest();
		originalHome = process.env.HOME;
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi-provider-"));
		// The temp dir is both home (user scope: ~/.pi/agent/…) and cwd (project
		// scope: .pi/…); loadCapability builds its context from os.homedir().
		process.env.HOME = tempDir;
		vi.spyOn(os, "homedir").mockReturnValue(tempDir);
		// .git bounds findRepoRoot so the skills ancestor walk stops at tempDir.
		await fs.mkdir(path.join(tempDir, ".git"), { recursive: true });

		await fs.mkdir(path.join(tempDir, ".pi", "agent", "skills", "pi-test-skill"), { recursive: true });
		await fs.writeFile(path.join(tempDir, ".pi", "settings.json"), JSON.stringify({ piFixture: true }));
		await fs.writeFile(
			path.join(tempDir, ".pi", "agent", "skills", "pi-test-skill", "SKILL.md"),
			"---\nname: pi-test-skill\ndescription: Fixture skill for pi discovery\n---\n\n# pi-test-skill\n",
		);
		await fs.mkdir(path.join(tempDir, ".pi", "commands"), { recursive: true });
		await fs.writeFile(path.join(tempDir, ".pi", "commands", "greet-pi.md"), "Say hello from pi\n");
	});

	afterEach(async () => {
		clearFsCache();
		resetSettingsForTest();
		vi.restoreAllMocks();
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		await removeWithRetries(tempDir);
	});

	test("registers with the capability registry on entry-point import", () => {
		const info = getProviderInfo("pi");
		expect(info).toBeDefined();
		expect(info?.capabilities).toEqual(
			expect.arrayContaining([settingsCapability.id, skillCapability.id, slashCommandCapability.id]),
		);
	});

	test("reports .pi/settings.json through the pi provider", async () => {
		const result = await loadCapability<Settings>(settingsCapability.id, {
			cwd: tempDir,
			providers: ["pi"],
		});

		expect(result.providers).toContain("pi");
		expect(result.warnings).toEqual([]);
		const item = result.items.find(entry => entry.path === path.join(tempDir, ".pi", "settings.json"));
		expect(item).toBeDefined();
		expect(item?.data).toEqual({ piFixture: true });
		expect(item?.level).toBe("project");
		expect(item?._source.provider).toBe("pi");
	});

	test("reports .pi/agent/skills/<name>/SKILL.md through the pi provider", async () => {
		const result = await loadCapability<Skill>(skillCapability.id, {
			cwd: tempDir,
			providers: ["pi"],
		});

		expect(result.providers).toContain("pi");
		const skill = result.items.find(entry => entry.name === "pi-test-skill");
		expect(skill).toBeDefined();
		expect(skill?.path).toBe(path.join(tempDir, ".pi", "agent", "skills", "pi-test-skill", "SKILL.md"));
		expect(skill?.level).toBe("user");
		expect(skill?._source.provider).toBe("pi");
	});

	test("loads slash commands from .pi/agent/commands and .pi/commands", async () => {
		const result = await loadCapability<SlashCommand>(slashCommandCapability.id, {
			cwd: tempDir,
			providers: ["pi"],
		});

		expect(result.providers).toContain("pi");
		const command = result.items.find(entry => entry.name === "greet-pi");
		expect(command).toBeDefined();
		expect(command?._source.path).toBe(path.join(tempDir, ".pi", "commands", "greet-pi.md"));
		expect(command?._source.provider).toBe("pi");
		expect(command?.level).toBe("project");
	});
});
