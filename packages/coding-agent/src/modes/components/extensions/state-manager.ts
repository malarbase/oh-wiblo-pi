/**
 * State manager for the Extension Control Center.
 * Handles data loading, tree building, filtering, and toggle persistence.
 */
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import type { ContextFile } from "../../../capability/context-file";
import type { ExtensionModule } from "../../../capability/extension-module";
import type { Hook } from "../../../capability/hook";
import type { MCPServer } from "../../../capability/mcp";
import type { Prompt } from "../../../capability/prompt";
import type { Rule } from "../../../capability/rule";
import type { Skill } from "../../../capability/skill";
import type { SlashCommand } from "../../../capability/slash-command";
import type { CustomTool } from "../../../capability/tool";
import type { SourceMeta } from "../../../capability/types";
import {
	disableProvider,
	enableProvider,
	getAllProvidersInfo,
	isProviderEnabled,
	loadCapability,
} from "../../../discovery";
import type {
	DashboardState,
	Extension,
	ExtensionKind,
	ExtensionState,
	FlatTreeItem,
	ProviderTab,
	TreeNode,
} from "./types";
import { makeExtensionId, sourceFromMeta } from "./types";

/**
 * Settings manager interface for granular toggle persistence.
 */
export interface ExtensionSettingsManager {
	getDisabledExtensions(): string[];
	setDisabledExtensions(ids: string[]): void;
}

/**
 * Load all extensions from all capabilities.
 */
export async function loadAllExtensions(cwd?: string, disabledIds?: string[]): Promise<Extension[]> {
	const extensions: Extension[] = [];
	const disabledExtensions = new Set<string>(disabledIds ?? []);

	// Helper to expand synthetic group entries for skills.
	// This allows bulk disabling of skills by repo, author, directory, or tag.
	//
	// The grouping UI uses a fallback chain for non-tag axes:
	//   repo  -> skill.repo ?? skill.author ?? skill.group
	//   author -> skill.author ?? skill.group
	//   dir   -> skill.group
	// The synthetic entry key stores the bucket value, not necessarily the field name.
	// We must match using the same fallback so a skill grouped under repo-axis as
	// "acme" (because it has author="acme" but no repo) is correctly disabled by
	// a "skill-repo:acme" entry.
	const expandDisabledGroups = (skill: Skill): void => {
		for (const disabled of disabledExtensions) {
			// skill-repo:<value> matches skills whose (repo ?? author ?? group) === value
			if (disabled.startsWith("skill-repo:")) {
				const value = disabled.slice("skill-repo:".length);
				if ((skill.repo ?? skill.author ?? skill.group) === value) {
					disabledExtensions.add(`skill:${skill.name}`);
				}
			}
			// skill-author:<value> matches skills whose (author ?? group) === value
			if (disabled.startsWith("skill-author:")) {
				const value = disabled.slice("skill-author:".length);
				if ((skill.author ?? skill.group) === value) {
					disabledExtensions.add(`skill:${skill.name}`);
				}
			}
			// skill-dir:<value> matches skills whose group === value
			if (disabled.startsWith("skill-dir:")) {
				const value = disabled.slice("skill-dir:".length);
				if (skill.group === value) {
					disabledExtensions.add(`skill:${skill.name}`);
				}
			}
			// skill-tag:<value> matches skills that have the tag
			if (disabled.startsWith("skill-tag:")) {
				const value = disabled.slice("skill-tag:".length);
				if (skill.tags?.includes(value)) {
					disabledExtensions.add(`skill:${skill.name}`);
				}
			}
		}
	};
	// Helper to convert capability items to extensions
	function addItems<T extends { name: string; path: string; _source: SourceMeta }>(
		items: T[],
		kind: ExtensionKind,
		opts?: {
			getDescription?: (item: T) => string | undefined;
			getTrigger?: (item: T) => string | undefined;
			getShadowedBy?: (item: T) => string | undefined;
		},
	): void {
		for (const item of items) {
			// Expand group entries for skills
			if (kind === "skill") {
				expandDisabledGroups(item as unknown as Skill);
			}

			const id = makeExtensionId(kind, item.name);
			const isDisabled = disabledExtensions.has(id);
			const isShadowed = (item as { _shadowed?: boolean })._shadowed;
			const providerEnabled = isProviderEnabled(item._source.provider);

			let state: ExtensionState;
			let disabledReason: "shadowed" | "provider-disabled" | "item-disabled" | undefined;

			// Item-disabled takes precedence over shadowed
			if (isDisabled) {
				state = "disabled";
				disabledReason = "item-disabled";
			} else if (isShadowed) {
				state = "shadowed";
				disabledReason = "shadowed";
			} else if (!providerEnabled) {
				state = "disabled";
				disabledReason = "provider-disabled";
			} else {
				state = "active";
			}

			const extension: Extension = {
				id,
				kind,
				name: item.name,
				displayName: item.name,
				description: opts?.getDescription?.(item),
				trigger: opts?.getTrigger?.(item),
				path: item.path,
				source: sourceFromMeta(item._source),
				state,
				disabledReason,
				shadowedBy: opts?.getShadowedBy?.(item),
				raw: item,
			};

			// Map metadata fields from skill to extension
			if (kind === "skill" && "author" in item) {
				const skill = item as unknown as Skill;
				extension.author = skill.author;
				extension.repo = skill.repo;
				extension.tags = skill.tags;
				extension.group = skill.group;
			}

			extensions.push(extension);
		}
	}

	const loadOpts = cwd ? { cwd, includeDisabled: true } : { includeDisabled: true };

	// Load skills
	try {
		const skills = await loadCapability<Skill>("skills", loadOpts);
		addItems(skills.items, "skill", {
			getDescription: s => s.frontmatter?.description,
			getTrigger: s => s.frontmatter?.globs?.join(", "),
		});
	} catch (error) {
		logger.warn("Failed to load skills capability", { error: String(error) });
	}

	// Load rules
	try {
		const rules = await loadCapability<Rule>("rules", loadOpts);
		addItems(rules.all, "rule", {
			getDescription: r => r.description,
			getTrigger: r => r.globs?.join(", ") || (r.alwaysApply ? "always" : undefined),
		});
	} catch (error) {
		logger.warn("Failed to load rules capability", { error: String(error) });
	}

	// Load custom tools
	try {
		const tools = await loadCapability<CustomTool>("tools", loadOpts);
		addItems(tools.all, "tool", {
			getDescription: t => t.description,
		});
	} catch (error) {
		logger.warn("Failed to load tools capability", { error: String(error) });
	}

	// Load extension modules
	try {
		const modules = await loadCapability<ExtensionModule>("extension-modules", loadOpts);
		const nativeModules = modules.all.filter(module => module._source.provider === "native");
		addItems(nativeModules, "extension-module");
	} catch (error) {
		logger.warn("Failed to load extension-modules capability", { error: String(error) });
	}

	// Load MCP servers
	try {
		const mcps = await loadCapability<MCPServer>("mcps", loadOpts);
		for (const server of mcps.all) {
			const id = makeExtensionId("mcp", server.name);
			const isDisabled = disabledExtensions.has(id);
			const isShadowed = (server as { _shadowed?: boolean })._shadowed;
			const providerEnabled = isProviderEnabled(server._source.provider);

			let state: ExtensionState;
			let disabledReason: "shadowed" | "provider-disabled" | "item-disabled" | undefined;

			if (isDisabled) {
				state = "disabled";
				disabledReason = "item-disabled";
			} else if (isShadowed) {
				state = "shadowed";
				disabledReason = "shadowed";
			} else if (!providerEnabled) {
				state = "disabled";
				disabledReason = "provider-disabled";
			} else {
				state = "active";
			}

			extensions.push({
				id,
				kind: "mcp",
				name: server.name,
				displayName: server.name,
				description: server.command || server.url,
				trigger: server.transport || "stdio",
				path: server._source.path,
				source: sourceFromMeta(server._source),
				state,
				disabledReason,
				raw: server,
			});
		}
	} catch (error) {
		logger.warn("Failed to load mcps capability", { error: String(error) });
	}

	// Load prompts
	try {
		const prompts = await loadCapability<Prompt>("prompts", loadOpts);
		addItems(prompts.all, "prompt", {
			getDescription: () => undefined,
			getTrigger: p => `/prompts:${p.name}`,
		});
	} catch (error) {
		logger.warn("Failed to load prompts capability", { error: String(error) });
	}

	// Load slash commands
	try {
		const commands = await loadCapability<SlashCommand>("slash-commands", loadOpts);
		addItems(commands.all, "slash-command", {
			getDescription: () => undefined,
			getTrigger: c => `/${c.name}`,
		});
	} catch (error) {
		logger.warn("Failed to load slash-commands capability", { error: String(error) });
	}

	// Load hooks
	try {
		const hooks = await loadCapability<Hook>("hooks", loadOpts);
		for (const hook of hooks.all) {
			const id = makeExtensionId("hook", `${hook.type}:${hook.tool}:${hook.name}`);
			const isDisabled = disabledExtensions.has(id);
			const isShadowed = (hook as { _shadowed?: boolean })._shadowed;
			const providerEnabled = isProviderEnabled(hook._source.provider);

			let state: ExtensionState;
			let disabledReason: "shadowed" | "provider-disabled" | "item-disabled" | undefined;

			if (isDisabled) {
				state = "disabled";
				disabledReason = "item-disabled";
			} else if (isShadowed) {
				state = "shadowed";
				disabledReason = "shadowed";
			} else if (!providerEnabled) {
				state = "disabled";
				disabledReason = "provider-disabled";
			} else {
				state = "active";
			}

			extensions.push({
				id,
				kind: "hook",
				name: hook.name,
				displayName: hook.name,
				description: `${hook.type}-${hook.tool}`,
				trigger: `${hook.type}:${hook.tool}`,
				path: hook.path,
				source: sourceFromMeta(hook._source),
				state,
				disabledReason,
				raw: hook,
			});
		}
	} catch (error) {
		logger.warn("Failed to load hooks capability", { error: String(error) });
	}

	// Load context files
	try {
		const contextFiles = await loadCapability<ContextFile>("context-files", loadOpts);
		for (const file of contextFiles.all) {
			// Extract filename from path for display
			const name = path.basename(file.path);
			const id = makeExtensionId("context-file", `${file.level}:${name}`);
			const isDisabled = disabledExtensions.has(id);
			const isShadowed = (file as { _shadowed?: boolean })._shadowed;
			const providerEnabled = isProviderEnabled(file._source.provider);

			let state: ExtensionState;
			let disabledReason: "shadowed" | "provider-disabled" | "item-disabled" | undefined;

			if (isDisabled) {
				state = "disabled";
				disabledReason = "item-disabled";
			} else if (isShadowed) {
				state = "shadowed";
				disabledReason = "shadowed";
			} else if (!providerEnabled) {
				state = "disabled";
				disabledReason = "provider-disabled";
			} else {
				state = "active";
			}

			extensions.push({
				id,
				kind: "context-file",
				name,
				displayName: name,
				description: file.level === "user" ? "User-level context" : "Project-level context",
				trigger: file.level,
				path: file.path,
				source: sourceFromMeta(file._source),
				state,
				disabledReason,
				raw: file,
			});
		}
	} catch (error) {
		logger.warn("Failed to load context-files capability", { error: String(error) });
	}

	return extensions;
}

/**
 * Build sidebar tree from extensions.
 * Groups by provider → kind.
 */
export function buildSidebarTree(extensions: Extension[]): TreeNode[] {
	const providers = getAllProvidersInfo();
	const tree: TreeNode[] = [];

	// Group extensions by provider and kind
	const byProvider = new Map<string, Map<ExtensionKind, Extension[]>>();

	for (const ext of extensions) {
		const providerId = ext.source.provider;
		if (!byProvider.has(providerId)) {
			byProvider.set(providerId, new Map());
		}
		const byKind = byProvider.get(providerId)!;
		if (!byKind.has(ext.kind)) {
			byKind.set(ext.kind, []);
		}
		byKind.get(ext.kind)!.push(ext);
	}

	// Build tree nodes for each provider (show ALL providers, even if disabled/empty)
	for (const provider of providers) {
		// Skip the 'native' provider as it cannot be toggled
		if (provider.id === "native") continue;

		const byKind = byProvider.get(provider.id);
		const kindNodes: TreeNode[] = [];
		let totalCount = 0;

		if (byKind && byKind.size > 0) {
			for (const [kind, exts] of byKind) {
				totalCount += exts.length;
				kindNodes.push({
					id: `${provider.id}:${kind}`,
					label: getKindDisplayName(kind),
					type: "kind",
					enabled: provider.enabled,
					collapsed: true,
					children: [],
					count: exts.length,
				});
			}

			// Sort kind nodes by count (most items first)
			kindNodes.sort((a, b) => (b.count || 0) - (a.count || 0));
		}

		tree.push({
			id: provider.id,
			label: provider.displayName,
			type: "provider",
			enabled: provider.enabled,
			collapsed: false,
			children: kindNodes,
			count: totalCount,
		});
	}

	return tree;
}

/**
 * Flatten tree for keyboard navigation.
 */
export function flattenTree(tree: TreeNode[]): FlatTreeItem[] {
	const flat: FlatTreeItem[] = [];
	let index = 0;

	function walk(node: TreeNode, depth: number): void {
		flat.push({ node, depth, index: index++ });
		if (!node.collapsed) {
			for (const child of node.children) {
				walk(child, depth + 1);
			}
		}
	}

	for (const node of tree) {
		walk(node, 0);
	}

	return flat;
}

/**
 * Apply fuzzy filter to extensions.
 */
export function applyFilter(extensions: Extension[], query: string): Extension[] {
	if (!query.trim()) {
		return extensions;
	}

	const rawTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (rawTokens.length === 0) {
		return extensions;
	}

	// Extract tag: prefix tokens; remainder is fuzzy-matched against name/description/etc.
	const tagFilters: string[] = [];
	const fuzzyTokens: string[] = [];
	for (const token of rawTokens) {
		if (token.startsWith("tag:")) {
			const value = token.slice(4);
			if (value) tagFilters.push(value);
		} else {
			fuzzyTokens.push(token);
		}
	}

	return extensions.filter(ext => {
		// All tag: filters must match (AND semantics)
		if (tagFilters.length > 0) {
			if (!ext.tags || ext.tags.length === 0) return false;
			const lowerTags = ext.tags.map(t => t.toLowerCase());
			if (!tagFilters.every(tf => lowerTags.some(t => t.includes(tf)))) return false;
		}

		// Remaining tokens: fuzzy match against searchable fields
		if (fuzzyTokens.length > 0) {
			const searchable = [
				ext.name,
				ext.displayName,
				ext.description || "",
				ext.trigger || "",
				ext.source.providerName,
				ext.kind,
			]
				.join(" ")
				.toLowerCase();
			if (!fuzzyTokens.every(token => searchable.includes(token))) return false;
		}

		return true;
	});
}

/**
 * Get display name for extension kind.
 */
function getKindDisplayName(kind: ExtensionKind): string {
	switch (kind) {
		case "extension-module":
			return "Extension Modules";
		case "skill":
			return "Skills";
		case "rule":
			return "Rules";
		case "tool":
			return "Tools";
		case "mcp":
			return "MCP Servers";
		case "prompt":
			return "Prompts";
		case "instruction":
			return "Instructions";
		case "context-file":
			return "Context Files";
		case "hook":
			return "Hooks";
		case "slash-command":
			return "Slash Commands";
		default:
			return kind;
	}
}

/**
 * Build provider tabs from extensions.
 */
export function buildProviderTabs(extensions: Extension[]): ProviderTab[] {
	const providers = getAllProvidersInfo();
	const tabs: ProviderTab[] = [];

	// Count extensions per provider
	const countByProvider = new Map<string, number>();
	for (const ext of extensions) {
		const count = countByProvider.get(ext.source.provider) ?? 0;
		countByProvider.set(ext.source.provider, count + 1);
	}

	// ALL tab first
	tabs.push({
		id: "all",
		label: "ALL",
		enabled: true,
		count: extensions.length,
	});

	// Provider tabs (skip native)
	for (const provider of providers) {
		if (provider.id === "native") continue;
		const count = countByProvider.get(provider.id) ?? 0;
		tabs.push({
			id: provider.id,
			label: provider.displayName,
			enabled: provider.enabled,
			count,
		});
	}

	// Sort: ALL first, then enabled by count, then disabled by count, then empty
	tabs.sort((a, b) => {
		if (a.id === "all") return -1;
		if (b.id === "all") return 1;

		// Categorize: 0 = enabled with content, 1 = disabled, 2 = empty+enabled
		const category = (t: ProviderTab) => {
			if (t.count === 0 && t.enabled) return 2; // empty
			if (!t.enabled) return 1; // disabled
			return 0; // enabled with content
		};

		const aCat = category(a);
		const bCat = category(b);
		if (aCat !== bCat) return aCat - bCat;

		// Within same category, sort by count descending
		return b.count - a.count;
	});

	return tabs;
}

/**
 * Filter extensions by provider tab.
 */
export function filterByProvider(extensions: Extension[], providerId: string): Extension[] {
	if (providerId === "all") {
		return extensions;
	}
	return extensions.filter(ext => ext.source.provider === providerId);
}

/**
 * Create initial dashboard state.
 */
export async function createInitialState(cwd?: string, disabledIds?: string[]): Promise<DashboardState> {
	const extensions = await loadAllExtensions(cwd, disabledIds);
	const tabs = buildProviderTabs(extensions);
	const tabFiltered = extensions; // "all" tab by default
	const searchFiltered = tabFiltered;

	return {
		tabs,
		activeTabIndex: 0,
		extensions,
		tabFiltered,
		searchFiltered,
		searchQuery: "",
		listIndex: 0,
		scrollOffset: 0,
		selected: searchFiltered[0] ?? null,
	};
}

/**
 * Toggle provider enabled state.
 */
export function toggleProvider(providerId: string): boolean {
	if (isProviderEnabled(providerId)) {
		disableProvider(providerId);
		return false;
	} else {
		enableProvider(providerId);
		return true;
	}
}

/**
 * Toggle a group of skills on/off by grouping axis and value.
 * Writing/removing synthetic entries from the settings.
 */
export function toggleGroup(
	settingsManager: ExtensionSettingsManager,
	extensions: Extension[],
	axis: "repo" | "author" | "dir" | "tag",
	groupValue: string,
	enabled: boolean,
): void {
	const disabled = new Set(settingsManager.getDisabledExtensions());
	const groupEntry = `skill-${axis}:${groupValue}`;

	if (enabled) {
		// Enabling a group: remove the group entry and individual skill entries for this group
		disabled.delete(groupEntry);

		// Also remove individual `skill:` entries for skills in this group.
		// Uses the same fallback chain as the grouping UI so skills bucketed via
		// fallback (e.g. repo-axis group whose key came from author) are cleared.
		const matchingSkills = extensions.filter(e => {
			if (e.kind !== "skill") return false;
			switch (axis) {
				case "repo":
					return (e.repo ?? e.author ?? e.group) === groupValue;
				case "author":
					return (e.author ?? e.group) === groupValue;
				case "dir":
					return e.group === groupValue;
				case "tag":
					return e.tags?.includes(groupValue);
				default:
					return false;
			}
		});

		for (const skill of matchingSkills) {
			disabled.delete(`skill:${skill.name}`);
		}
	} else {
		// Disabling a group: add the group entry
		disabled.add(groupEntry);
	}

	settingsManager.setDisabledExtensions(Array.from(disabled));
}

/**
 * Re-evaluate state (active/disabled/shadowed) for all extensions in the current state
 * using only in-memory data: the provided disabled ID set and the global provider enable flags.
 * No disk I/O. Used for optimistic UI updates immediately after a toggle.
 */
export function reevaluateExtensionStates(extensions: Extension[], disabledIds: string[]): void {
	const disabledSet = new Set<string>(disabledIds);

	// Expand synthetic group entries so individual skill IDs get added.
	// Uses the same fallback chain as the grouping UI:
	//   skill-repo:<v>   matches skills where (repo ?? author ?? group) === v
	//   skill-author:<v> matches skills where (author ?? group) === v
	//   skill-dir:<v>    matches skills where group === v
	//   skill-tag:<v>    matches skills that include v in their tags
	for (const ext of extensions) {
		if (ext.kind !== "skill") continue;
		const skill = ext.raw as Skill;
		for (const entry of disabledSet) {
			if (
				entry.startsWith("skill-repo:") &&
				(skill.repo ?? skill.author ?? skill.group) === entry.slice("skill-repo:".length)
			)
				disabledSet.add(`skill:${ext.name}`);
			if (entry.startsWith("skill-author:") && (skill.author ?? skill.group) === entry.slice("skill-author:".length))
				disabledSet.add(`skill:${ext.name}`);
			if (entry.startsWith("skill-dir:") && skill.group === entry.slice("skill-dir:".length))
				disabledSet.add(`skill:${ext.name}`);
			if (entry.startsWith("skill-tag:") && skill.tags?.includes(entry.slice("skill-tag:".length)))
				disabledSet.add(`skill:${ext.name}`);
		}
	}

	for (const ext of extensions) {
		const isDisabled = disabledSet.has(ext.id);
		const providerEnabled = isProviderEnabled(ext.source.provider);
		if (isDisabled) {
			ext.state = "disabled";
			ext.disabledReason = "item-disabled";
		} else if (!providerEnabled) {
			ext.state = "disabled";
			ext.disabledReason = "provider-disabled";
		} else {
			// Don't upgrade shadowed back to active — shadowed is a structural fact
			// from the capability layer, not something we can change here.
			if (ext.state !== "shadowed") {
				ext.state = "active";
				ext.disabledReason = undefined;
			}
		}
	}
}

/**
 * Refresh state after toggle.
 */
export async function refreshState(
	state: DashboardState,
	cwd?: string,
	disabledIds?: string[],
): Promise<DashboardState> {
	const extensions = await loadAllExtensions(cwd, disabledIds);
	const tabs = buildProviderTabs(extensions);

	// Get current provider from tabs
	const activeTab = state.tabs[state.activeTabIndex];
	const providerId = activeTab?.id ?? "all";

	// Re-apply filters
	const tabFiltered = filterByProvider(extensions, providerId);
	const searchFiltered = applyFilter(tabFiltered, state.searchQuery);

	// Find new index for current provider (tabs may have reordered)
	const newActiveTabIndex = tabs.findIndex(t => t.id === providerId);
	const activeTabIndex = newActiveTabIndex >= 0 ? newActiveTabIndex : 0;

	// Try to preserve selection
	const selectedId = state.selected?.id;
	let selected = selectedId ? searchFiltered.find(e => e.id === selectedId) : null;
	if (!selected && searchFiltered.length > 0) {
		selected = searchFiltered[Math.min(state.listIndex, searchFiltered.length - 1)];
	}

	return {
		...state,
		tabs,
		activeTabIndex,
		extensions,
		tabFiltered,
		searchFiltered,
		selected: selected ?? null,
		listIndex: selected ? searchFiltered.indexOf(selected) : 0,
	};
}
