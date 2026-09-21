import { beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LoadContext } from "../../src/capability/types";
import { scanSkillsFromDir } from "../../src/discovery/helpers";
import { ExtensionList } from "../../src/modes/components/extensions/extension-list";
import type { ExtensionSettingsManager } from "../../src/modes/components/extensions/state-manager";
import {
	createExtensionSettingsAdapter,
	isSkillDisabledByGroup,
	toggleExtensionState,
	toggleGroup,
} from "../../src/modes/components/extensions/state-manager";
import type { DashboardState, Extension } from "../../src/modes/components/extensions/types";
import { initTheme } from "../../src/modes/theme/theme";

describe("Skill Metadata Parsing & Grouping Infrastructure", () => {
	beforeAll(async () => {
		await initTheme();
	});
	it("parses author, repo, tags, and group from skill frontmatter", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-test-"));
		const skillFolder = path.join(tempDir, "my-group-skill");
		await fs.mkdir(skillFolder, { recursive: true });
		const skillFile = path.join(skillFolder, "SKILL.md");

		await fs.writeFile(
			skillFile,
			`---
name: test-skill
description: A test skill with grouping metadata
author: Alice
repo: https://github.com/alice/skills
tags: [helper, lint, format]
---
# Test Skill Body
`,
			"utf-8",
		);

		const ctx: LoadContext = { home: tempDir, cwd: tempDir, repoRoot: null };
		const result = await scanSkillsFromDir(ctx, {
			dir: tempDir,
			providerId: "native",
			level: "user",
		});

		expect(result.items.length).toBe(1);
		const skill = result.items[0];
		expect(skill.name).toBe("test-skill");
		expect(skill.author).toBe("Alice");
		expect(skill.repo).toBe("https://github.com/alice/skills");
		expect(skill.tags).toEqual(["helper", "lint", "format"]);
		expect(skill.group).toBe("my-group-skill");

		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("correctly identifies skills disabled by synthetic group keys", () => {
		const skillExt: Extension = {
			id: "skill:test-skill",
			kind: "skill",
			name: "test-skill",
			displayName: "test-skill",
			path: "/path/to/skill",
			source: { provider: "native", providerName: "Native", level: "user" },
			state: "active",
			raw: {},
			author: "Bob",
			repo: "my-repo",
			tags: ["ci", "testing"],
			group: "custom-group",
		};

		const disabledByTag = new Set(["skill-tag:testing"]);
		expect(isSkillDisabledByGroup(skillExt, disabledByTag)).toBe(true);

		const disabledByDir = new Set(["skill-dir:custom-group"]);
		expect(isSkillDisabledByGroup(skillExt, disabledByDir)).toBe(true);

		const disabledByAuthor = new Set(["skill-author:Bob"]);
		expect(isSkillDisabledByGroup(skillExt, disabledByAuthor)).toBe(true);

		const disabledByRepo = new Set(["skill-repo:my-repo"]);
		expect(isSkillDisabledByGroup(skillExt, disabledByRepo)).toBe(true);

		const notDisabled = new Set(["skill-tag:unrelated"]);
		expect(isSkillDisabledByGroup(skillExt, notDisabled)).toBe(false);
	});

	it("bulk toggles skills by group using toggleGroup", () => {
		const skill1: Extension = {
			id: "skill:skill-1",
			kind: "skill",
			name: "skill-1",
			displayName: "skill-1",
			path: "/path/1",
			source: { provider: "native", providerName: "Native", level: "user" },
			state: "active",
			raw: {},
			tags: ["utils"],
			group: "g1",
		};

		const skill2: Extension = {
			id: "skill:skill-2",
			kind: "skill",
			name: "skill-2",
			displayName: "skill-2",
			path: "/path/2",
			source: { provider: "native", providerName: "Native", level: "user" },
			state: "active",
			raw: {},
			tags: ["utils"],
			group: "g1",
		};

		let disabledList: string[] = [];
		const mockSettings: ExtensionSettingsManager = {
			getDisabledExtensions: () => disabledList,
			setDisabledExtensions: (list: string[]) => {
				disabledList = list;
			},
		} as unknown as ExtensionSettingsManager;

		const state: DashboardState = {
			tabs: [],
			activeTabIndex: 0,
			extensions: [skill1, skill2],
			tabFiltered: [skill1, skill2],
			searchFiltered: [skill1, skill2],
			searchQuery: "",
			listIndex: 0,
			scrollOffset: 0,
			selected: skill1,
		};

		// Toggle group off
		const newState = toggleGroup(state, "tag", "utils", mockSettings);
		expect(disabledList).toContain("skill-tag:utils");
		expect(disabledList).toContain("skill:skill-1");
		expect(disabledList).toContain("skill:skill-2");
		expect(newState.extensions[0].state).toBe("disabled");
		expect(newState.extensions[1].state).toBe("disabled");

		// Toggle group back on
		const reEnabledState = toggleGroup(newState, "tag", "utils", mockSettings);
		expect(disabledList).not.toContain("skill-tag:utils");
		expect(disabledList).not.toContain("skill:skill-1");
		expect(disabledList).not.toContain("skill:skill-2");
		expect(reEnabledState.extensions[0].state).toBe("active");
		expect(reEnabledState.extensions[1].state).toBe("active");
	});

	it("clears synthetic group keys when re-enabling an individual skill", () => {
		const skill: Extension = {
			id: "skill:skill-1",
			kind: "skill",
			name: "skill-1",
			displayName: "skill-1",
			path: "/path/1",
			source: { provider: "native", providerName: "Native", level: "user" },
			state: "disabled",
			disabledReason: "item-disabled",
			raw: {},
			tags: ["formatting"],
			group: "formatters",
		};

		let disabledList = ["skill-tag:formatting", "skill-dir:formatters", "skill:skill-1"];
		const mockSettings: ExtensionSettingsManager = {
			getDisabledExtensions: () => disabledList,
			setDisabledExtensions: (list: string[]) => {
				disabledList = list;
			},
		} as unknown as ExtensionSettingsManager;

		const state: DashboardState = {
			tabs: [],
			activeTabIndex: 0,
			extensions: [skill],
			tabFiltered: [skill],
			searchFiltered: [skill],
			searchQuery: "",
			listIndex: 0,
			scrollOffset: 0,
			selected: skill,
		};

		const updatedState = toggleExtensionState(state, skill, mockSettings);
		expect(disabledList).not.toContain("skill-tag:formatting");
		expect(disabledList).not.toContain("skill-dir:formatters");
		expect(disabledList).not.toContain("skill:skill-1");
		expect(updatedState.extensions[0].state).toBe("active");
	});

	it("adapts generic Settings objects with get/set via createExtensionSettingsAdapter", () => {
		const storage: Record<string, any> = {
			disabledExtensions: ["skill-tag:old"],
		};
		const settingsObj = {
			get: (key: string) => storage[key],
			set: (key: string, val: any) => {
				storage[key] = val;
			},
		};

		const adapter = createExtensionSettingsAdapter(settingsObj);
		expect(adapter.getDisabledExtensions()).toEqual(["skill-tag:old"]);

		adapter.setDisabledExtensions(["skill-tag:new"]);
		expect(storage.disabledExtensions).toEqual(["skill-tag:new"]);
	});

	it("cycles grouping axis in ExtensionList when cycleGroupingAxis is called", () => {
		const list = new ExtensionList([]);
		expect(list.getGroupingAxis()).toBe("dir");
		expect(list.cycleGroupingAxis()).toBe("tag");
		expect(list.cycleGroupingAxis()).toBe("repo");
		expect(list.cycleGroupingAxis()).toBe("author");
		expect(list.cycleGroupingAxis()).toBe("dir");
	});

	it("leaves skills without active metadata ungrouped instead of falling back to default values", () => {
		const skillWithAuthor: Extension = {
			id: "skill:s1",
			kind: "skill",
			name: "s1",
			displayName: "Skill With Author",
			path: "/p1",
			source: { provider: "native", providerName: "Native", level: "user" },
			state: "active",
			raw: {},
			author: "Alice",
			group: "g1",
		};
		const skillWithoutAuthor: Extension = {
			id: "skill:s2",
			kind: "skill",
			name: "s2",
			displayName: "Skill Without Author",
			path: "/p2",
			source: { provider: "native", providerName: "Native", level: "user" },
			state: "active",
			raw: {},
			group: "g2",
		};

		const list = new ExtensionList([skillWithAuthor, skillWithoutAuthor]);
		// Set axis to author
		list.cycleGroupingAxis(); // tag
		list.cycleGroupingAxis(); // repo
		list.cycleGroupingAxis(); // author

		const rendered = list.render(80).join("\n");
		// Alice group header should be rendered
		expect(rendered).toContain("Alice");
		expect(rendered).toContain("Skill Without Author");
		// Skill without author should be listed below as flat skill row (not creating a dummy group header for g2 or s2)
		expect(rendered).not.toContain("author:g2");
		expect(rendered).not.toContain("author:s2");
	});
});
