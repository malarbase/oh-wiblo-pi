import { afterEach, describe, expect, test } from "bun:test";
import { disableProvider, enableProvider } from "@oh-my-pi/pi-coding-agent/capability";
import {
	applyDisabledExtensionsToState,
	applyFilter,
	buildProviderTabs,
	buildSidebarTree,
	filterByProvider,
	flattenTree,
} from "@oh-my-pi/pi-coding-agent/modes/components/extensions/state-manager";
import type { DashboardState, Extension } from "@oh-my-pi/pi-coding-agent/modes/components/extensions/types";

function makeSkill(
	name: string,
	opts: {
		state?: Extension["state"];
		disabledReason?: Extension["disabledReason"];
		provider?: string;
		description?: string;
	} = {},
): Extension {
	return {
		id: `skill:${name}`,
		kind: "skill",
		name,
		displayName: name,
		description: opts.description,
		path: `/skills/${name}/SKILL.md`,
		source: {
			provider: opts.provider ?? "pi",
			providerName: opts.provider ?? "pi",
			level: "user",
		},
		state: opts.state ?? "active",
		disabledReason: opts.disabledReason,
		raw: { name, path: `/skills/${name}/SKILL.md` },
	};
}

function makeRule(name: string, opts: { state?: Extension["state"]; provider?: string } = {}): Extension {
	return {
		id: `rule:${name}`,
		kind: "rule",
		name,
		displayName: name,
		path: `/rules/${name}.md`,
		source: { provider: opts.provider ?? "pi", providerName: opts.provider ?? "pi", level: "user" },
		state: opts.state ?? "active",
		raw: { name, path: `/rules/${name}.md` },
	};
}

describe("applyFilter", () => {
	const extensions: Extension[] = [
		makeSkill("context7-cli", { description: "docs library" }),
		makeSkill("find-docs", { description: "search docs" }),
		makeSkill("system-prompts", { description: "prompts" }),
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
		const result = applyFilter(extensions, "find skill");
		expect(result).toHaveLength(1);
		expect(result[0]!.name).toBe("find-docs");
	});
});

describe("applyDisabledExtensionsToState", () => {
	const PROVIDER = "test-provider";

	afterEach(() => {
		enableProvider(PROVIDER);
	});

	function makeState(extensions: Extension[]): DashboardState {
		return {
			tabs: [],
			activeTabIndex: 0,
			extensions,
			tabFiltered: extensions,
			searchFiltered: extensions,
			searchQuery: "",
			listIndex: 0,
			scrollOffset: 0,
			selected: extensions[0] ?? null,
		};
	}

	test("active extension stays active when not in disabled set", () => {
		const ext = makeSkill("alpha", { provider: PROVIDER });
		const newState = applyDisabledExtensionsToState(makeState([ext]), []);
		expect(newState.extensions[0]!.state).toBe("active");
		expect(newState.extensions[0]!.disabledReason).toBeUndefined();
	});

	test("extension in disabled set is marked item-disabled", () => {
		const ext = makeSkill("alpha", { provider: PROVIDER });
		const newState = applyDisabledExtensionsToState(makeState([ext]), ["skill:alpha"]);
		expect(newState.extensions[0]!.state).toBe("disabled");
		expect(newState.extensions[0]!.disabledReason).toBe("item-disabled");
	});

	test("extension recovers to active when removed from disabled set", () => {
		const ext = makeSkill("alpha", { state: "disabled", disabledReason: "item-disabled", provider: PROVIDER });
		const newState = applyDisabledExtensionsToState(makeState([ext]), []);
		expect(newState.extensions[0]!.state).toBe("active");
		expect(newState.extensions[0]!.disabledReason).toBeUndefined();
	});

	test("provider-disabled overrides active when provider is off", () => {
		disableProvider(PROVIDER);
		const ext = makeSkill("alpha", { state: "disabled", disabledReason: "item-disabled", provider: PROVIDER });
		const newState = applyDisabledExtensionsToState(makeState([ext]), []);
		expect(newState.extensions[0]!.state).toBe("disabled");
		expect(newState.extensions[0]!.disabledReason).toBe("provider-disabled");
	});

	test("item-disabled takes precedence when in disabled set", () => {
		disableProvider(PROVIDER);
		const ext = makeSkill("alpha", { provider: PROVIDER });
		const newState = applyDisabledExtensionsToState(makeState([ext]), ["skill:alpha"]);
		expect(newState.extensions[0]!.state).toBe("disabled");
		expect(newState.extensions[0]!.disabledReason).toBe("item-disabled");
	});
});

describe("buildSidebarTree and flattenTree", () => {
	test("builds tree grouped by provider", () => {
		const exts = [makeSkill("alpha", { provider: "pi" }), makeRule("beta", { provider: "pi" })];
		const tree = buildSidebarTree(exts);
		expect(tree).toBeArray();
		const flat = flattenTree(tree);
		expect(flat).toBeArray();
	});
});

describe("buildProviderTabs and filterByProvider", () => {
	test("builds tabs with ALL first", () => {
		const exts = [makeSkill("alpha", { provider: "pi" })];
		const tabs = buildProviderTabs(exts);
		expect(tabs[0]!.id).toBe("all");
		expect(tabs[0]!.count).toBe(1);

		const filtered = filterByProvider(exts, "pi");
		expect(filtered).toHaveLength(1);
		const allFiltered = filterByProvider(exts, "all");
		expect(allFiltered).toHaveLength(1);
	});
});
