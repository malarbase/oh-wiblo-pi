/**
 * ExtensionList - Inventory list with Master Switch, skill grouping, and fuzzy search.
 *
 * When viewing a specific provider (not "ALL"), Row #0 is the Master Switch
 * that toggles the entire provider. All items below are dimmed when the
 * master switch is off. Skills can be grouped by directory, tag, repo, or author.
 */
import { type Component, matchesKey, padding, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import { isProviderEnabled } from "../../../discovery";
import { theme } from "../../../modes/theme/theme";
import { matchesSelectDown, matchesSelectUp } from "../../utils/keybinding-matchers";
import { clampSelection, contentRowWidth, renderScrollableList, searchableChar } from "../selector-helpers";
import { sanitizeDisplayLine } from "./display-text";
import {
	formatExtensionListHint,
	joinListHints,
	liveToolsForExtension,
	projectListHint,
	type ToolRuntimeSource,
} from "./inspector-model";
import { snapshotToolRuntimeSource } from "./live-tool-session";
import {
	formatMcpListHint,
	isDiscoveredMcpServer,
	type MCPConnectionHealth,
	type MCPRuntimeSource,
	snapshotMcpRuntime,
} from "./mcp-runtime";
import { applyFilter } from "./state-manager";
import { type Extension, type ExtensionKind, type ExtensionState, isShadowedExtension } from "./types";

export type GroupingAxis = "dir" | "tag" | "repo" | "author";

export interface ExtensionListCallbacks {
	onSelectionChange?: (extension: Extension | null) => void;
	onToggle?: (extensionId: string, enabled: boolean) => void;
	onMasterToggle?: (providerId: string) => void;
	/** Called when skill group is toggled */
	onGroupToggle?: (groupAxis: GroupingAxis, groupValue: string, enabled: boolean) => void;
	/** Provider ID for master switch (null = no master switch) */
	masterSwitchProvider?: string | null;
	mcpSource?: MCPRuntimeSource;
	toolSource?: ToolRuntimeSource;
}

const DEFAULT_MAX_VISIBLE = 15;

/** Flattened list item for rendering */
type ListItem =
	| { type: "master"; providerId: string; providerName: string; enabled: boolean }
	| { type: "kind-header"; kind: ExtensionKind; label: string; icon: string; count: number }
	| {
			type: "group-header";
			groupAxis: GroupingAxis;
			groupValue: string;
			label: string;
			count: number;
			enabled: boolean;
			mixed: boolean;
	  }
	| { type: "extension"; item: Extension; grouped?: boolean };

export class ExtensionList implements Component {
	#listItems: ListItem[] = [];
	#selectedIndex = 0;
	#scrollOffset = 0;
	#searchQuery = "";
	#focused = false;
	#masterSwitchProvider: string | null = null;
	#maxVisible: number;
	#hoveredIndex: number | null = null;
	#groupingAxis: GroupingAxis = "dir";
	/** Item rows rendered in the last frame, for mouse hit-testing. */
	#visibleCount = 0;
	#mcpSource: MCPRuntimeSource | undefined;
	#toolSource: ToolRuntimeSource | undefined;
	#toolFrame: ToolRuntimeSource | undefined;

	constructor(
		private extensions: Extension[],
		private readonly callbacks: ExtensionListCallbacks = {},
		maxVisible?: number,
	) {
		this.#masterSwitchProvider = callbacks.masterSwitchProvider ?? null;
		this.#mcpSource = callbacks.mcpSource;
		this.#toolSource = callbacks.toolSource;
		this.#maxVisible = maxVisible ?? DEFAULT_MAX_VISIBLE;
		this.#rebuildList();
	}

	setMaxVisible(maxVisible: number): void {
		this.#maxVisible = maxVisible;
		this.#clampSelection();
	}

	setExtensions(extensions: Extension[]): void {
		this.extensions = extensions;
		this.#rebuildList();
		this.#clampSelection();
	}

	setFocused(focused: boolean): void {
		this.#focused = focused;
	}

	setMasterSwitchProvider(providerId: string | null): void {
		this.#masterSwitchProvider = providerId;
		this.#rebuildList();
	}

	cycleGroupingAxis(): GroupingAxis {
		const order: GroupingAxis[] = ["dir", "tag", "repo", "author"];
		const nextIdx = (order.indexOf(this.#groupingAxis) + 1) % order.length;
		this.#groupingAxis = order[nextIdx];
		this.#rebuildList();
		this.#clampSelection();
		this.#notifySelectionChange();
		return this.#groupingAxis;
	}

	getGroupingAxis(): GroupingAxis {
		return this.#groupingAxis;
	}

	setMcpSource(source: MCPRuntimeSource | undefined): void {
		this.#mcpSource = source;
	}

	setToolSource(source: ToolRuntimeSource | undefined): void {
		this.#toolSource = source;
	}

	getSearchQuery(): string {
		return this.#searchQuery;
	}

	resetSelection(): void {
		this.#selectedIndex = 0;
		this.#scrollOffset = 0;
		this.#notifySelectionChange();
	}

	getSelectedExtension(): Extension | null {
		const item = this.#listItems[this.#selectedIndex];
		return item?.type === "extension" ? item.item : null;
	}

	getSelectedKind(): ExtensionKind | null {
		const item = this.#listItems[this.#selectedIndex];
		return item?.type === "kind-header" ? item.kind : null;
	}

	setSearchQuery(query: string): void {
		this.#searchQuery = query;
		this.#rebuildList();
		this.#selectedIndex = 0;
		this.#scrollOffset = 0;
		this.#notifySelectionChange();
	}

	clearSearch(): void {
		this.setSearchQuery("");
	}

	invalidate(): void {}

	render(width: number): readonly string[] {
		this.#toolFrame = snapshotToolRuntimeSource(this.#toolSource);
		const lines: string[] = [];
		this.#visibleCount = 0;

		// Search bar
		const searchPrefix = theme.fg("muted", "Search: ");
		const searchText = this.#searchQuery || (this.#focused ? "" : theme.fg("dim", "type to filter"));
		const cursor = this.#focused ? theme.fg("accent", "_") : "";
		lines.push(searchPrefix + searchText + cursor);
		lines.push("");

		if (this.#listItems.length === 0) {
			lines.push(theme.fg("muted", "  No extensions found for this provider."));
			return lines;
		}

		// Determine if master switch is off (for dimming child items)
		const masterDisabled = this.#masterSwitchProvider !== null && !isProviderEnabled(this.#masterSwitchProvider);

		// Calculate visible range
		const startIdx = this.#scrollOffset;
		const endIdx = Math.min(startIdx + this.#maxVisible, this.#listItems.length);

		// Reserve the rightmost column for the scrollbar when overflowing
		const rowWidth = contentRowWidth(width, this.#listItems.length, this.#maxVisible);

		// Render visible items
		const rows: string[] = [];
		for (let i = startIdx; i < endIdx; i++) {
			const listItem = this.#listItems[i];
			const isSelected = this.#focused && i === this.#selectedIndex;
			const isHovered = this.#focused && i === this.#hoveredIndex && !isSelected;

			let rowStr: string;
			if (listItem.type === "master") {
				rowStr = this.#renderMasterSwitch(listItem, isSelected, rowWidth);
			} else if (listItem.type === "kind-header") {
				rowStr = this.#renderKindHeader(listItem, isSelected, rowWidth);
			} else if (listItem.type === "group-header") {
				rowStr = this.#renderGroupHeader(listItem, isSelected, rowWidth);
			} else {
				rowStr = this.#renderExtensionRow(listItem.item, isSelected, rowWidth, masterDisabled, listItem.grouped);
			}
			if (isHovered) rowStr = theme.bg("selectedBg", rowStr);
			rows.push(rowStr);
		}
		this.#visibleCount = rows.length;

		lines.push(
			...renderScrollableList(rows, {
				width,
				totalRows: this.#listItems.length,
				scrollOffset: this.#scrollOffset,
			}),
		);

		return lines;
	}

	#renderMasterSwitch(item: ListItem & { type: "master" }, isSelected: boolean, width: number): string {
		const checkbox = item.enabled
			? theme.fg("success", theme.checkbox.checked)
			: theme.fg("dim", theme.checkbox.unchecked);
		const icon = theme.icon.package;
		const label = `Enable ${item.providerName}`;
		const badge = theme.fg("warning", "(Master Switch)");

		let line = `${checkbox} ${icon} ${label}  ${badge}`;

		if (isSelected) {
			line = theme.bold(theme.fg("accent", line));
			line = theme.bg("selectedBg", line);
		} else if (!item.enabled) {
			line = theme.fg("dim", line);
		}

		return truncateToWidth(line, width);
	}

	#renderKindHeader(item: ListItem & { type: "kind-header" }, isSelected: boolean, width: number): string {
		const countBadge = theme.fg("muted", `(${item.count})`);
		let line = `${item.icon} ${item.label} ${countBadge}`;

		if (isSelected) {
			line = theme.bold(theme.fg("accent", line));
			line = theme.bg("selectedBg", line);
		} else {
			line = theme.fg("muted", line);
		}

		return truncateToWidth(line, width);
	}

	#renderGroupHeader(item: ListItem & { type: "group-header" }, isSelected: boolean, width: number): string {
		const checkbox = item.enabled
			? item.mixed
				? theme.fg("warning", theme.checkbox?.checked ?? "[x]")
				: theme.fg("success", theme.checkbox?.checked ?? "[x]")
			: theme.fg("dim", theme.checkbox?.unchecked ?? "[ ]");

		const iconMap: Record<GroupingAxis, string> = {
			dir: theme.icon?.folder ?? "📁",
			tag: "#",
			repo: "📦",
			author: "@",
		};
		const icon = iconMap[item.groupAxis] ?? "📁";
		const countBadge = theme.fg("muted", `(${item.count})`);
		const axisPrefix = theme.fg("dim", `${item.groupAxis}:`);

		let line = `  ${checkbox} ${icon} ${axisPrefix}${item.label} ${countBadge}`;

		if (isSelected) {
			line = theme.bold(theme.fg("accent", line));
			line = theme.bg("selectedBg", line);
		} else if (!item.enabled) {
			line = theme.fg("dim", line);
		}

		return truncateToWidth(line, width);
	}

	#renderExtensionRow(ext: Extension, isSelected: boolean, width: number, masterDisabled: boolean, grouped = false): string {
		const shadowed = isShadowedExtension(ext);
		const effectivelyDisabled = masterDisabled || ext.state === "disabled";
		const mcpSnap =
			ext.kind === "mcp" && isDiscoveredMcpServer(ext.raw) && !shadowed
				? snapshotMcpRuntime(ext.raw, this.#mcpSource, {
						enabled: !effectivelyDisabled,
						shadowed: false,
					})
				: undefined;

		const stateIcon = shadowed
			? this.#getStateIcon("shadowed", masterDisabled)
			: mcpSnap
				? this.#getMcpHealthIcon(mcpSnap.health, masterDisabled)
				: this.#getStateIcon(ext.state, masterDisabled);
		let name = sanitizeDisplayLine(ext.displayName);
		const nameWidth = Math.min(24, width - 16);

		let line = grouped ? `     ${stateIcon} ` : `   ${stateIcon} `;

		if (isSelected && !masterDisabled) {
			name = theme.bold(theme.fg("accent", name));
		} else if (effectivelyDisabled) {
			name = theme.fg("dim", name);
		} else if (shadowed) {
			name = theme.fg("warning", name);
		}

		const namePadded = this.#padText(name, nameWidth);
		line += namePadded;

		const hint = mcpSnap
			? joinListHints(formatMcpListHint(mcpSnap), projectListHint(ext))
			: formatExtensionListHint(ext, ext.kind === "tool" ? liveToolsForExtension(ext, this.#toolFrame) : []);
		if (hint) {
			const triggerStyle = effectivelyDisabled
				? "dim"
				: mcpSnap?.health === "disconnected" || mcpSnap?.health === "inactive"
					? mcpSnap.health === "inactive"
						? "warning"
						: "dim"
					: "muted";
			const remainingWidth = width - visibleWidth(line) - 2;
			if (remainingWidth > 5) {
				line += `  ${truncateToWidth(theme.fg(triggerStyle, sanitizeDisplayLine(hint)), remainingWidth)}`;
			}
		}

		if (isSelected) {
			line = theme.bg("selectedBg", line);
		}

		return truncateToWidth(line, width);
	}

	#getKindIcon(kind: ExtensionKind): string {
		switch (kind) {
			case "extension-module":
				return theme.icon?.extensionTool ?? "🔧";
			case "skill":
				return theme.icon?.extensionSkill ?? "⚡";
			case "tool":
				return theme.icon?.extensionTool ?? "🔧";
			case "slash-command":
				return theme.icon?.extensionSlashCommand ?? "/";
			case "mcp":
				return theme.icon?.extensionMcp ?? "🔌";
			case "rule":
				return theme.icon?.extensionRule ?? "📜";
			case "hook":
				return theme.icon?.extensionHook ?? "🪝";
			case "prompt":
				return theme.icon?.extensionPrompt ?? "💬";
			case "context-file":
				return theme.icon?.extensionContextFile ?? "📄";
			case "instruction":
				return theme.icon?.extensionInstruction ?? "📋";
			default:
				return theme.format?.bullet ?? "•";
		}
	}

	#getStateIcon(state: ExtensionState, masterDisabled: boolean): string {
		if (masterDisabled) {
			return theme.fg("dim", theme.status?.disabled ?? "[ ]");
		}
		switch (state) {
			case "active":
				return theme.fg("success", theme.status?.enabled ?? "[x]");
			case "disabled":
				return theme.fg("dim", theme.status?.disabled ?? "[ ]");
			case "shadowed":
				return theme.fg("warning", theme.status?.shadowed ?? "[-]");
		}
	}

	#getMcpHealthIcon(health: MCPConnectionHealth, masterDisabled: boolean): string {
		if (masterDisabled) {
			return theme.fg("dim", theme.status.disabled);
		}
		switch (health) {
			case "connected":
				return theme.fg("success", theme.status.enabled);
			case "connecting":
				return theme.fg("muted", theme.status.running);
			case "disconnected":
				return theme.fg("dim", theme.status.shadowed);
			case "inactive":
				return theme.fg("warning", theme.status.disabled);
		}
	}

	#padText(text: string, targetWidth: number): string {
		const width = visibleWidth(text);
		if (width >= targetWidth) {
			return truncateToWidth(text, targetWidth);
		}
		return text + padding(targetWidth - width);
	}

	#skillGroupKeys(ext: Extension): string[] {
		if (this.#groupingAxis === "tag") {
			return ext.tags && ext.tags.length > 0 ? ext.tags : [];
		}
		const key = this.#skillGroupKey(ext);
		return key !== null ? [key] : [];
	}

	#skillGroupKey(ext: Extension): string | null {
		if (this.#groupingAxis === "repo") return ext.repo ?? null;
		if (this.#groupingAxis === "author") return ext.author ?? null;
		if (this.#groupingAxis === "dir") return ext.group ?? null;
		return null;
	}

	#rebuildList(): void {
		this.#listItems = [];

		const filtered = this.#searchQuery.length > 0 ? applyFilter(this.extensions, this.#searchQuery) : this.extensions;

		if (this.#searchQuery.length > 0) {
			for (const ext of filtered) {
				this.#listItems.push({ type: "extension", item: ext, grouped: false });
			}
			return;
		}

		if (this.#masterSwitchProvider) {
			const providerName = filtered[0]?.source.providerName ?? this.#masterSwitchProvider;
			const enabled = isProviderEnabled(this.#masterSwitchProvider);

			this.#listItems.push({
				type: "master",
				providerId: this.#masterSwitchProvider,
				providerName,
				enabled,
			});

			if (filtered.some(e => e.kind === "skill")) {
				const groups = new Map<string, Extension[]>();
				const ungrouped: Extension[] = [];
				const nonSkills: Extension[] = [];

				for (const ext of filtered) {
					if (ext.kind !== "skill") {
						nonSkills.push(ext);
						continue;
					}
					const keys = this.#skillGroupKeys(ext);
					if (keys.length > 0) {
						for (const key of keys) {
							const list = groups.get(key) ?? [];
							list.push(ext);
							groups.set(key, list);
						}
					} else {
						ungrouped.push(ext);
					}
				}

				for (const [groupValue, skills] of groups) {
					const allDisabled = skills.every(s => s.state === "disabled");
					const anyDisabled = skills.some(s => s.state === "disabled");
					this.#listItems.push({
						type: "group-header",
						groupAxis: this.#groupingAxis,
						groupValue,
						label: groupValue,
						count: skills.length,
						enabled: !allDisabled,
						mixed: anyDisabled && !allDisabled,
					});
					for (const skill of skills) {
						this.#listItems.push({ type: "extension", item: skill, grouped: true });
					}
				}

				for (const skill of ungrouped) {
					this.#listItems.push({ type: "extension", item: skill, grouped: false });
				}
				for (const ext of nonSkills) {
					this.#listItems.push({ type: "extension", item: ext, grouped: false });
				}
			} else {
				for (const ext of filtered) {
					this.#listItems.push({ type: "extension", item: ext, grouped: false });
				}
			}
			return;
		}

		const byKind = new Map<ExtensionKind, Extension[]>();
		for (const ext of filtered) {
			const list = byKind.get(ext.kind) ?? [];
			list.push(ext);
			byKind.set(ext.kind, list);
		}

		const kindOrder: ExtensionKind[] = [
			"extension-module",
			"skill",
			"tool",
			"slash-command",
			"rule",
			"mcp",
			"hook",
			"prompt",
			"context-file",
			"instruction",
		];

		for (const kind of kindOrder) {
			const items = byKind.get(kind);
			if (!items || items.length === 0) continue;

			this.#listItems.push({
				type: "kind-header",
				kind,
				label: this.#getKindLabel(kind),
				icon: this.#getKindIcon(kind),
				count: items.length,
			});

			if (kind === "skill") {
				const groups = new Map<string, Extension[]>();
				const ungrouped: Extension[] = [];
				for (const ext of items) {
					const keys = this.#skillGroupKeys(ext);
					if (keys.length > 0) {
						for (const key of keys) {
							const list = groups.get(key) ?? [];
							list.push(ext);
							groups.set(key, list);
						}
					} else {
						ungrouped.push(ext);
					}
				}
				for (const [groupValue, skills] of groups) {
					const allDisabled = skills.every(s => s.state === "disabled");
					const anyDisabled = skills.some(s => s.state === "disabled");
					this.#listItems.push({
						type: "group-header",
						groupAxis: this.#groupingAxis,
						groupValue,
						label: groupValue,
						count: skills.length,
						enabled: !allDisabled,
						mixed: anyDisabled && !allDisabled,
					});
					for (const skill of skills) {
						this.#listItems.push({ type: "extension", item: skill, grouped: true });
					}
				}
				for (const ext of ungrouped) {
					this.#listItems.push({ type: "extension", item: ext, grouped: false });
				}
			} else {
				for (const ext of items) {
					this.#listItems.push({ type: "extension", item: ext, grouped: false });
				}
			}
		}
	}

	#getKindLabel(kind: ExtensionKind): string {
		switch (kind) {
			case "extension-module":
				return "Extension Modules";
			case "skill":
				return "Skills";
			case "tool":
				return "Tools";
			case "slash-command":
				return "Commands";
			case "rule":
				return "Rules";
			case "mcp":
				return "MCP Servers";
			case "hook":
				return "Hooks";
			case "prompt":
				return "Prompts";
			case "context-file":
				return "Context";
			case "instruction":
				return "Instructions";
			default:
				return kind;
		}
	}

	#clampSelection(): void {
		const next = clampSelection(this.#selectedIndex, this.#scrollOffset, this.#listItems.length, this.#maxVisible);
		this.#selectedIndex = next.selectedIndex;
		this.#scrollOffset = next.scrollOffset;
	}

	#activateSelected(): void {
		const item = this.#listItems[this.#selectedIndex];
		if (item?.type === "master") {
			this.callbacks.onMasterToggle?.(item.providerId);
		} else if (item?.type === "group-header") {
			const newEnabled = !item.enabled;
			this.callbacks.onGroupToggle?.(item.groupAxis, item.groupValue, newEnabled);
		} else if (item?.type === "extension") {
			// Shadowed same-name rows share the winner's id (`mcp:github`).
			// Toggling them would mutate whichever config `find(id)` hits first.
			if (isShadowedExtension(item.item)) return;
			const masterDisabled = this.#masterSwitchProvider !== null && !isProviderEnabled(this.#masterSwitchProvider);
			if (!masterDisabled) {
				const newEnabled = item.item.state === "disabled";
				this.callbacks.onToggle?.(item.item.id, newEnabled);
			}
		}
	}

	setHoverIndex(index: number | null): void {
		this.#hoveredIndex = index;
	}

	hitTest(line: number): number | null {
		const rowLine = line - 2;
		if (rowLine < 0 || rowLine >= this.#visibleCount) return null;
		const index = this.#scrollOffset + rowLine;
		return index < this.#listItems.length ? index : null;
	}

	handleWheel(delta: -1 | 1): void {
		if (delta < 0) this.#moveSelectionUp();
		else this.#moveSelectionDown();
	}

	handleClick(line: number): void {
		const index = this.hitTest(line);
		if (index === null) return;
		if (index === this.#selectedIndex) {
			this.#activateSelected();
			return;
		}
		this.#selectedIndex = index;
		this.#notifySelectionChange();
	}

	handleInput(data: string): void {
		if (matchesSelectUp(data) || matchesKey(data, "k")) {
			this.#moveSelectionUp();
			return;
		}

		if (matchesSelectDown(data) || matchesKey(data, "j")) {
			this.#moveSelectionDown();
			return;
		}

		if (data === " " || matchesKey(data, "enter") || matchesKey(data, "return") || data === "\n") {
			this.#activateSelected();
			return;
		}

		if (matchesKey(data, "backspace")) {
			if (this.#searchQuery.length > 0) {
				this.setSearchQuery(this.#searchQuery.slice(0, -1));
			}
			return;
		}

		const char = searchableChar(data);
		if (char !== null) {
			this.setSearchQuery(this.#searchQuery + char);
		}
	}

	#moveSelectionUp(): void {
		if (this.#selectedIndex > 0) {
			this.#selectedIndex--;
			if (this.#selectedIndex < this.#scrollOffset) {
				this.#scrollOffset = this.#selectedIndex;
			}
			this.#notifySelectionChange();
		}
	}

	#moveSelectionDown(): void {
		if (this.#selectedIndex < this.#listItems.length - 1) {
			this.#selectedIndex++;
			if (this.#selectedIndex >= this.#scrollOffset + this.#maxVisible) {
				this.#scrollOffset = this.#selectedIndex - this.#maxVisible + 1;
			}
			this.#notifySelectionChange();
		}
	}

	#notifySelectionChange(): void {
		const ext = this.getSelectedExtension();
		this.callbacks.onSelectionChange?.(ext);
	}
}
