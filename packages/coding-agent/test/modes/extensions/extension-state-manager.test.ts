import { afterEach, describe, expect, test } from "bun:test";
import { disableProvider, enableProvider } from "@oh-my-pi/pi-coding-agent/capability";
import type { ExtensionSettingsManager } from "@oh-my-pi/pi-coding-agent/modes/components/extensions/state-manager";
import {
	applyFilter,
	reevaluateExtensionStates,
	toggleGroup,
} from "@oh-my-pi/pi-coding-agent/modes/components/extensions/state-manager";
import type { Extension } from "@oh-my-pi/pi-coding-agent/modes/components/extensions/types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSkill(
	name: string,
	opts: {
		state?: Extension["state"];
		author?: string;
		repo?: string;
		tags?: string[];
		group?: string;
		provider?: string;
	} = {},
): Extension {
	return {
		id: `skill:${name}`,
		kind: "skill",
		name,
		displayName: name,
		path: `/skills/${name}/SKILL.md`,
		source: {
			provider: opts.provider ?? "pi",
			providerName: opts.provider ?? "pi",
			level: "user",
		},
		state: opts.state ?? "active",
		raw: {
			name,
			path: `/skills/${name}/SKILL.md`,
			author: opts.author,
			repo: opts.repo,
			tags: opts.tags,
			group: opts.group,
		},
		author: opts.author,
		repo: opts.repo,
		tags: opts.tags,
		group: opts.group,
	};
}

function makeRule(name: string, opts: { state?: Extension["state"] } = {}): Extension {
	return {
		id: `rule:${name}`,
		kind: "rule",
		name,
		displayName: name,
		path: `/rules/${name}.md`,
		source: { provider: "pi", providerName: "pi", level: "user" },
		state: opts.state ?? "active",
		raw: { name, path: `/rules/${name}.md` },
	};
}

function makeSettingsManager(initial: string[] = []): ExtensionSettingsManager & { store: string[] } {
	const store = [...initial];
	return {
		store,
		getDisabledExtensions: () => [...store],
		setDisabledExtensions: (ids: string[]) => {
			store.length = 0;
			store.push(...ids);
		},
	};
}

// ---------------------------------------------------------------------------
// applyFilter
// ---------------------------------------------------------------------------

describe("applyFilter", () => {
	const extensions: Extension[] = [
		makeSkill("context7-cli", { author: "ctx7", tags: ["docs", "library"] }),
		makeSkill("find-docs", { author: "openspec", tags: ["docs", "search"] }),
		makeSkill("system-prompts", { author: "openspec", tags: ["prompts"] }),
		makeRule("no-console"),
	];

	test("empty query returns all extensions", () => {
		expect(applyFilter(extensions, "").length).toBe(extensions.length);
		expect(applyFilter(extensions, "   ").length).toBe(extensions.length);
	});

	test("fuzzy token matches name substring", () => {
		const result = applyFilter(extensions, "context7");
		expect(result).toHaveLength(1);
		expect(result[0]!.name).toBe("context7-cli");
	});

	test("fuzzy token matches kind", () => {
		const result = applyFilter(extensions, "rule");
		expect(result).toHaveLength(1);
		expect(result[0]!.kind).toBe("rule");
	});

	test("multiple fuzzy tokens are ANDed", () => {
		// 'find' matches 'find-docs' by name; 'skill' matches all skills by kind.
		// Together they match only skills whose name contains 'find'.
		const result = applyFilter(extensions, "find skill");
		expect(result).toHaveLength(1);
		expect(result[0]!.name).toBe("find-docs");
	});

	test("tag: prefix filters by tags array", () => {
		const result = applyFilter(extensions, "tag:docs");
		expect(result).toHaveLength(2);
		const names = result.map(e => e.name).sort();
		expect(names).toEqual(["context7-cli", "find-docs"]);
	});

	test("tag: prefix is case-insensitive substring match", () => {
		const result = applyFilter(extensions, "tag:DOCS");
		expect(result).toHaveLength(2);
	});

	test("multiple tag: tokens are ANDed", () => {
		// only find-docs has both 'docs' and 'search'
		const result = applyFilter(extensions, "tag:docs tag:search");
		expect(result).toHaveLength(1);
		expect(result[0]!.name).toBe("find-docs");
	});

	test("tag: prefix combined with fuzzy token", () => {
		// tag:docs narrows to context7-cli + find-docs; 'find' narrows further to find-docs
		const result = applyFilter(extensions, "tag:docs find");
		expect(result).toHaveLength(1);
		expect(result[0]!.name).toBe("find-docs");
	});

	test("tag: filter excludes extensions with no tags", () => {
		const result = applyFilter(extensions, "tag:docs");
		expect(result.every(e => e.tags && e.tags.length > 0)).toBe(true);
		expect(result.find(e => e.kind === "rule")).toBeUndefined();
	});

	test("tag: with value not present in any extension returns empty", () => {
		expect(applyFilter(extensions, "tag:nonexistent")).toHaveLength(0);
	});

	test("empty tag: value (tag:) is ignored and does not crash", () => {
		// "tag:" with no value produces an empty string; we skip empty values
		const result = applyFilter(extensions, "tag:");
		expect(result.length).toBe(extensions.length);
	});
});

// ---------------------------------------------------------------------------
// reevaluateExtensionStates
// ---------------------------------------------------------------------------

describe("reevaluateExtensionStates", () => {
	const PROVIDER = "test-provider";

	afterEach(() => {
		// Restore provider to enabled state so other tests are not polluted.
		enableProvider(PROVIDER);
	});

	test("active extension stays active when not in disabled set", () => {
		const ext = makeSkill("alpha", { provider: PROVIDER });
		reevaluateExtensionStates([ext], []);
		expect(ext.state).toBe("active");
		expect(ext.disabledReason).toBeUndefined();
	});

	test("extension in disabled set is marked item-disabled", () => {
		const ext = makeSkill("alpha", { provider: PROVIDER });
		reevaluateExtensionStates([ext], ["skill:alpha"]);
		expect(ext.state).toBe("disabled");
		expect(ext.disabledReason).toBe("item-disabled");
	});

	test("extension recovers to active when removed from disabled set", () => {
		const ext = makeSkill("alpha", { state: "disabled", provider: PROVIDER });
		ext.disabledReason = "item-disabled";
		reevaluateExtensionStates([ext], []);
		expect(ext.state).toBe("active");
		expect(ext.disabledReason).toBeUndefined();
	});

	test("provider-disabled overrides active when provider is off", () => {
		disableProvider(PROVIDER);
		const ext = makeSkill("alpha", { provider: PROVIDER });
		reevaluateExtensionStates([ext], []);
		expect(ext.state).toBe("disabled");
		expect(ext.disabledReason).toBe("provider-disabled");
	});

	test("item-disabled takes precedence over provider-disabled", () => {
		disableProvider(PROVIDER);
		const ext = makeSkill("alpha", { provider: PROVIDER });
		reevaluateExtensionStates([ext], ["skill:alpha"]);
		expect(ext.state).toBe("disabled");
		expect(ext.disabledReason).toBe("item-disabled");
	});

	test("shadowed extension is not upgraded to active", () => {
		const ext = makeSkill("alpha", { state: "shadowed", provider: PROVIDER });
		reevaluateExtensionStates([ext], []);
		expect(ext.state).toBe("shadowed");
	});

	test("shadowed extension is disabled when its id is in disabled set", () => {
		const ext = makeSkill("alpha", { state: "shadowed", provider: PROVIDER });
		reevaluateExtensionStates([ext], ["skill:alpha"]);
		// item-disabled takes precedence over shadowed
		expect(ext.state).toBe("disabled");
		expect(ext.disabledReason).toBe("item-disabled");
	});

	test("synthetic skill-author: entry disables matching skills", () => {
		const a = makeSkill("skill-a", { author: "acme", provider: PROVIDER });
		const b = makeSkill("skill-b", { author: "acme", provider: PROVIDER });
		const c = makeSkill("skill-c", { author: "other", provider: PROVIDER });
		reevaluateExtensionStates([a, b, c], ["skill-author:acme"]);
		expect(a.state).toBe("disabled");
		expect(b.state).toBe("disabled");
		expect(c.state).toBe("active");
	});

	test("synthetic skill-repo: entry disables matching skills", () => {
		const a = makeSkill("skill-a", { repo: "myrepo", provider: PROVIDER });
		const b = makeSkill("skill-b", { repo: "other", provider: PROVIDER });
		reevaluateExtensionStates([a, b], ["skill-repo:myrepo"]);
		expect(a.state).toBe("disabled");
		expect(b.state).toBe("active");
	});

	test("synthetic skill-dir: entry disables matching skills", () => {
		const a = makeSkill("skill-a", { group: "mydir", provider: PROVIDER });
		const b = makeSkill("skill-b", { group: "other", provider: PROVIDER });
		reevaluateExtensionStates([a, b], ["skill-dir:mydir"]);
		expect(a.state).toBe("disabled");
		expect(b.state).toBe("active");
	});

	test("non-skill extensions are not affected by synthetic group entries", () => {
		const rule = makeRule("no-console");
		reevaluateExtensionStates([rule], ["skill-author:acme"]);
		expect(rule.state).toBe("active");
	});

	test("handles multiple extensions with different providers independently", () => {
		const p1 = "provider-one";
		const p2 = "provider-two";
		disableProvider(p1);
		const a = makeSkill("skill-a", { provider: p1 });
		const b = makeSkill("skill-b", { provider: p2 });
		reevaluateExtensionStates([a, b], []);
		expect(a.state).toBe("disabled");
		expect(a.disabledReason).toBe("provider-disabled");
		expect(b.state).toBe("active");
		enableProvider(p1); // cleanup
	});
	test("skill-repo: entry disables skills that fall back to author when repo is absent", () => {
		// Skill has no repo; grouping UI uses author as the bucket key.
		// skill-repo:acme must disable it via the fallback chain.
		const a = makeSkill("skill-a", { author: "acme", provider: "test-provider" });
		const b = makeSkill("skill-b", { author: "other", provider: "test-provider" });
		reevaluateExtensionStates([a, b], ["skill-repo:acme"]);
		expect(a.state).toBe("disabled");
		expect(b.state).toBe("active");
	});

	test("skill-repo: entry disables skills that fall back to group dir when repo and author absent", () => {
		const a = makeSkill("skill-a", { group: "mydir", provider: "test-provider" });
		reevaluateExtensionStates([a], ["skill-repo:mydir"]);
		expect(a.state).toBe("disabled");
	});

	test("skill-author: entry disables skills that fall back to group when author absent", () => {
		const a = makeSkill("skill-a", { group: "mydir", provider: "test-provider" });
		reevaluateExtensionStates([a], ["skill-author:mydir"]);
		expect(a.state).toBe("disabled");
	});
});

// ---------------------------------------------------------------------------
// toggleGroup
// ---------------------------------------------------------------------------

describe("toggleGroup", () => {
	test("disabling a group adds synthetic group entry", () => {
		const sm = makeSettingsManager([]);
		const exts = [makeSkill("skill-a", { author: "acme" })];
		toggleGroup(sm, exts, "author", "acme", false);
		expect(sm.store).toContain("skill-author:acme");
	});

	test("disabling an already-disabled group is idempotent", () => {
		const sm = makeSettingsManager(["skill-author:acme"]);
		const exts = [makeSkill("skill-a", { author: "acme" })];
		toggleGroup(sm, exts, "author", "acme", false);
		const count = sm.store.filter(e => e === "skill-author:acme").length;
		expect(count).toBe(1);
	});

	test("enabling a group removes the synthetic group entry", () => {
		const sm = makeSettingsManager(["skill-author:acme"]);
		const exts = [makeSkill("skill-a", { author: "acme" })];
		toggleGroup(sm, exts, "author", "acme", true);
		expect(sm.store).not.toContain("skill-author:acme");
	});

	test("enabling a group also removes individual skill entries for that group", () => {
		const sm = makeSettingsManager(["skill-author:acme", "skill:skill-a", "skill:skill-b"]);
		const exts = [makeSkill("skill-a", { author: "acme" }), makeSkill("skill-b", { author: "acme" })];
		toggleGroup(sm, exts, "author", "acme", true);
		expect(sm.store).not.toContain("skill:skill-a");
		expect(sm.store).not.toContain("skill:skill-b");
	});

	test("enabling a group does not remove individual entries for skills in other groups", () => {
		const sm = makeSettingsManager(["skill-author:acme", "skill:other-skill"]);
		const exts = [makeSkill("skill-a", { author: "acme" }), makeSkill("other-skill", { author: "other" })];
		toggleGroup(sm, exts, "author", "acme", true);
		expect(sm.store).toContain("skill:other-skill");
	});

	test("toggleGroup by repo axis writes skill-repo: entry", () => {
		const sm = makeSettingsManager([]);
		toggleGroup(sm, [], "repo", "github.com/acme/repo", false);
		expect(sm.store).toContain("skill-repo:github.com/acme/repo");
	});

	test("toggleGroup by dir axis writes skill-dir: entry", () => {
		const sm = makeSettingsManager([]);
		toggleGroup(sm, [], "dir", "mygroup", false);
		expect(sm.store).toContain("skill-dir:mygroup");
	});

	test("toggleGroup by tag axis writes skill-tag: entry", () => {
		const sm = makeSettingsManager([]);
		toggleGroup(sm, [], "tag", "security", false);
		expect(sm.store).toContain("skill-tag:security");
	});

	test("enabling group by tag removes matching individual skill entries", () => {
		const sm = makeSettingsManager(["skill-tag:docs", "skill:find-docs", "skill:unrelated"]);
		const exts = [makeSkill("find-docs", { tags: ["docs", "search"] }), makeSkill("unrelated", { tags: ["other"] })];
		toggleGroup(sm, exts, "tag", "docs", true);
		expect(sm.store).not.toContain("skill-tag:docs");
		expect(sm.store).not.toContain("skill:find-docs");
		// unrelated has no 'docs' tag, so its individual entry survives
		expect(sm.store).toContain("skill:unrelated");
	});

	test("enabling group by dir axis removes matching individual skill entries", () => {
		const sm = makeSettingsManager(["skill-dir:groupA", "skill:skill-a"]);
		const exts = [makeSkill("skill-a", { group: "groupA" })];
		toggleGroup(sm, exts, "dir", "groupA", true);
		expect(sm.store).not.toContain("skill:skill-a");
	});

	test("non-skill extensions are not considered when enabling group", () => {
		const sm = makeSettingsManager(["skill-author:acme", "rule:no-console"]);
		const exts = [makeRule("no-console")];
		toggleGroup(sm, exts, "author", "acme", true);
		// rule entry must remain untouched
		expect(sm.store).toContain("rule:no-console");
	});

	test("disabling group does not touch existing individual skill entries", () => {
		const sm = makeSettingsManager(["skill:already-disabled"]);
		toggleGroup(sm, [], "author", "acme", false);
		expect(sm.store).toContain("skill:already-disabled");
		expect(sm.store).toContain("skill-author:acme");
	});
	test("enabling repo group removes individual entries for skills bucketed via author fallback", () => {
		// Skill has no repo; it was bucketed under repo-axis group "acme" via author fallback.
		// Enabling the group must still clear its individual entry.
		const sm = makeSettingsManager(["skill-repo:acme", "skill:skill-a"]);
		const exts = [makeSkill("skill-a", { author: "acme" })];
		toggleGroup(sm, exts, "repo", "acme", true);
		expect(sm.store).not.toContain("skill-repo:acme");
		expect(sm.store).not.toContain("skill:skill-a");
	});

	test("enabling author group removes individual entries for skills bucketed via dir fallback", () => {
		const sm = makeSettingsManager(["skill-author:mydir", "skill:skill-a"]);
		const exts = [makeSkill("skill-a", { group: "mydir" })];
		toggleGroup(sm, exts, "author", "mydir", true);
		expect(sm.store).not.toContain("skill-author:mydir");
		expect(sm.store).not.toContain("skill:skill-a");
	});
});
