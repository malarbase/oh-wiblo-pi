import { type AutocompleteItem } from "@oh-my-pi/pi-tui";
import { COLLAB_GUEST_ALLOWED_COMMANDS } from "../collab/guest";
import { clearSubmittedText } from "./helpers/draft";
import {
	buildArgumentCompletions,
	buildDirectoryArgumentCompletions,
	buildEffortArgumentCompletions,
	buildEffortInlineHint,
	buildMcpArgumentCompletions,
	buildModelSelectorCompletions,
	buildStaticInlineHint,
	buildSubcommandInlineHint,
} from "./builtin-completions";
import { BUILTIN_SKILLS_SLASH_COMMANDS } from "./builtin-skills";
import { listSavedPlans } from "../plan-mode/storage";
import { handleAddProviderCommand } from "./commands/add-provider";
import { commandConsumed, parseSlashCommand } from "./helpers/parse";
import type {
	BuiltinSlashCommand,
	ParsedSlashCommand,
	SlashCommandResult,
	SlashCommandRuntime,
	SlashCommandSpec,
	SubcommandDef,
	TuiSlashCommandRuntime,
} from "./types";

import { BUILTIN_COLLABORATION_SLASH_COMMANDS } from "./builtin-collaboration";
import { BUILTIN_CONTROL_SLASH_COMMANDS } from "./builtin-control";
import { BUILTIN_LIFECYCLE_SLASH_COMMANDS } from "./builtin-lifecycle";
import { BUILTIN_MARKETPLACE_SLASH_COMMANDS, reloadTuiPluginState } from "./builtin-marketplace";
import { BUILTIN_MODE_SLASH_COMMANDS } from "./builtin-modes";
import { BUILTIN_SESSION_SLASH_COMMANDS } from "./builtin-session";
export type { BuiltinSlashCommand, SubcommandDef } from "./types";

/** TUI-specific runtime accepted by `executeBuiltinSlashCommand`. */
export type BuiltinSlashCommandRuntime = TuiSlashCommandRuntime;

export interface TuiBuiltinSlashCommand extends BuiltinSlashCommand {
	getArgumentCompletions?: (prefix: string) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
	getInlineHint?: (argumentText: string) => string | null;
	getAutocompleteDescription?: () => string | undefined;
}

const BUILTIN_SLASH_COMMAND_REGISTRY: ReadonlyArray<SlashCommandSpec> = [
	// Upstream composition: satellite arrays first; inline defs below carry
	// fork-only commands and intentional fork deltas (last-wins lookup).
	...BUILTIN_MODE_SLASH_COMMANDS,
	...BUILTIN_COLLABORATION_SLASH_COMMANDS,
	...BUILTIN_SESSION_SLASH_COMMANDS,
	// Fork delta: the `debug` name belongs to the debug-mode toggle below, so
	// upstream's selector spec is filtered out here — its capability stays
	// reachable as `/debug tools` (and via the global debug keybinding).
	...BUILTIN_LIFECYCLE_SLASH_COMMANDS.filter(command => command.name !== "debug"),
	...BUILTIN_MARKETPLACE_SLASH_COMMANDS,
	...BUILTIN_SKILLS_SLASH_COMMANDS,
	...BUILTIN_CONTROL_SLASH_COMMANDS,
	{
		name: "ask",
		description: "Toggle ask mode (read-only, no write tools)",
		handleTui: async (_command, runtime) => {
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleAskModeCommand();
		},
	},
	{
		name: "agent",
		description: "Switch to standard agent mode",
		handleTui: async (_command, runtime) => {
			runtime.ctx.editor.setText("");
			if (runtime.ctx.planModeEnabled) {
				await runtime.ctx.handlePlanModeCommand();
			} else if (runtime.ctx.askModeEnabled) {
				await runtime.ctx.handleAskModeCommand();
			} else if (runtime.ctx.debugModeEnabled) {
				await runtime.ctx.handleDebugModeCommand();
			} else {
				runtime.ctx.showStatus("Agent mode is active.");
			}
		},
	},
	{
		name: "debug",
		description: "Toggle debug mode (debug with runtime evidence)",
		allowArgs: true,
		subcommands: [{ name: "tools", description: "Open debug tools selector" }],
		handleTui: async (command, runtime) => {
			const args = command.args.trim().toLowerCase();
			runtime.ctx.editor.setText("");
			if (args === "") {
				await runtime.ctx.handleDebugModeCommand();
			} else if (args === "tools") {
				await runtime.ctx.showDebugSelector();
			} else {
				runtime.ctx.showWarning(`Usage: /${command.name} [tools]`);
			}
		},
	},
	// [stale duplicate removed: satellite version governs]
	// [stale duplicate removed: satellite version governs]
	{
		name: "drop",
		description: "Delete the current session and start a new one",
		handleTui: async (_command, runtime) => {
			runtime.ctx.editor.setText("");
			await runtime.ctx.handleDeleteCommand();
		},
	},
	// [stale duplicate removed: satellite version governs]
	// [stale duplicate removed: satellite version governs]
	// [stale duplicate removed: satellite version governs]
	// [stale duplicate removed: satellite version governs]
	{
		name: "refresh-models",
		description: "Force re-fetch model discovery for all or a specific provider",
		inlineHint: "[provider]",
		allowArgs: true,
		handle: async (command, runtime) => {
			const registry = runtime.session.modelRegistry;
			const provider = command.args.trim();
			if (provider) {
				const discoverable = registry.getDiscoverableProviders();
				if (!discoverable.includes(provider)) {
					await runtime.output(
						`Unknown discoverable provider: ${provider}. Available: ${discoverable.join(", ") || "(none)"}`,
					);
					return commandConsumed();
				}
				await runtime.output(`Refreshing models for ${provider}...`);
				await registry.refreshProvider(provider, "online");
				const state = registry.getProviderDiscoveryState(provider);
				const count = state?.models.length ?? 0;
				await runtime.output(
					`Refreshed ${provider}: ${count} model${count === 1 ? "" : "s"} (${state?.status ?? "unknown"}).`,
				);
			} else {
				await runtime.output("Refreshing all model providers...");
				await registry.refresh("online");
				const providers = registry.getDiscoverableProviders();
				const summary = providers
					.map(p => {
						const s = registry.getProviderDiscoveryState(p);
						return `${p}: ${s?.models.length ?? 0} (${s?.status ?? "?"})`;
					})
					.join(", ");
				await runtime.output(`Models refreshed. ${summary}`);
			}
			return commandConsumed();
		},
	},
	{
		name: "add-provider",
		description: "Add a custom model provider",
		allowArgs: true,
		inlineHint: "<name> <baseUrl> <apiKey>",
		...handleAddProviderCommand,
	},
];

const BUILTIN_SLASH_COMMAND_LOOKUP = new Map<string, SlashCommandSpec>();
for (const command of BUILTIN_SLASH_COMMAND_REGISTRY) {
	BUILTIN_SLASH_COMMAND_LOOKUP.set(command.name, command);
	for (const alias of command.aliases ?? []) {
		BUILTIN_SLASH_COMMAND_LOOKUP.set(alias, command);
	}
}

export const BUILTIN_SLASH_COMMAND_RESERVED_NAMES: ReadonlySet<string> = new Set(BUILTIN_SLASH_COMMAND_LOOKUP.keys());

function buildPlanArgumentCompletions(
	subcommands: SubcommandDef[],
	runtime: TuiSlashCommandRuntime,
): (argumentPrefix: string) => Promise<AutocompleteItem[] | null> {
	const genericCompletions = buildArgumentCompletions(subcommands);
	return async (argumentPrefix: string) => {
		const spaceIndex = argumentPrefix.indexOf(" ");
		if (spaceIndex === -1) return genericCompletions(argumentPrefix);

		const rawSubcommand = argumentPrefix.slice(0, spaceIndex).toLowerCase();
		if (rawSubcommand !== "run" && rawSubcommand !== "load") return null;
		const namePrefix = argumentPrefix.slice(spaceIndex + 1).toLowerCase();

		try {
			const plans = await listSavedPlans({
				cwd: runtime.ctx.sessionManager.getCwd(),
				getArtifactsDir: () => runtime.ctx.sessionManager.getArtifactsDir(),
				getSessionId: () => runtime.ctx.sessionManager.getSessionId(),
			});
			const matches: AutocompleteItem[] = plans
				.filter(p => p.name.toLowerCase().startsWith(namePrefix))
				.map(p => ({
					value: `${rawSubcommand} ${p.name} `,
					label: p.name,
					description: `${p.location} plan (${p.url})`,
				}));
			return matches.length > 0 ? matches : null;
		} catch {
			return null;
		}
	};
}

/** Builtin command metadata used for slash-command autocomplete and help text. */
export const BUILTIN_SLASH_COMMAND_DEFS: ReadonlyArray<BuiltinSlashCommand> = BUILTIN_SLASH_COMMAND_REGISTRY.map(
	command => ({
		name: command.name,
		aliases: command.aliases,
		allowArgs: command.allowArgs === true,
		// Getter: some descriptions name keys, formatted at read time (theme/preset may change).
		get description() {
			return command.description;
		},
		icon: command.icon,
		subcommands: command.subcommands,
		subcommandOptional: command.subcommandOptional,
		inlineHint: command.inlineHint,
		getTuiAutocompleteDescription: command.getTuiAutocompleteDescription,
	}),
);

function materializeTuiBuiltinSlashCommand(
	cmd: BuiltinSlashCommand,
	runtime?: TuiSlashCommandRuntime,
): TuiBuiltinSlashCommand {
	const materialized: TuiBuiltinSlashCommand = { ...cmd };
	if (cmd.subcommands) {
		const subcommands = cmd.subcommands;
		// `/mcp` and `/effort` narrow their declarative lists to live session
		// state so the dropdown never offers a value the handler would reject.
		// Fork: `/plan run|load` completes saved plan names from live session state.
		if (runtime && cmd.name === "mcp") {
			materialized.getArgumentCompletions = buildMcpArgumentCompletions(subcommands, runtime);
			materialized.getInlineHint = buildSubcommandInlineHint(subcommands);
		} else if (runtime && cmd.name === "effort") {
			materialized.getArgumentCompletions = buildEffortArgumentCompletions(runtime);
			materialized.getInlineHint = buildEffortInlineHint(runtime);
		} else if (runtime && cmd.name === "plan") {
			materialized.getArgumentCompletions = buildPlanArgumentCompletions(subcommands, runtime);
			materialized.getInlineHint = buildSubcommandInlineHint(subcommands);
		} else {
			const options = { optional: cmd.subcommandOptional };
			materialized.getArgumentCompletions = buildArgumentCompletions(subcommands, options);
			materialized.getInlineHint = buildSubcommandInlineHint(subcommands, options);
		}
	} else if (cmd.name === "move") {
		materialized.getArgumentCompletions = buildDirectoryArgumentCompletions();
		if (cmd.inlineHint) materialized.getInlineHint = buildStaticInlineHint(cmd.inlineHint);
	} else if (cmd.name === "switch" && runtime) {
		materialized.getArgumentCompletions = buildModelSelectorCompletions(runtime);
		if (cmd.inlineHint) materialized.getInlineHint = buildStaticInlineHint(cmd.inlineHint);
	} else if (cmd.inlineHint) {
		materialized.getInlineHint = buildStaticInlineHint(cmd.inlineHint);
	}
	if (runtime && cmd.getTuiAutocompleteDescription) {
		materialized.getAutocompleteDescription = () => cmd.getTuiAutocompleteDescription?.(runtime);
	}
	return materialized;
}

/**
 * Materialized builtin slash commands with completion functions derived from
 * declarative subcommand/hint definitions.
 */
export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<TuiBuiltinSlashCommand> = BUILTIN_SLASH_COMMAND_DEFS.map(cmd =>
	materializeTuiBuiltinSlashCommand(cmd),
);

export function buildTuiBuiltinSlashCommands(runtime: TuiSlashCommandRuntime): ReadonlyArray<TuiBuiltinSlashCommand> {
	return BUILTIN_SLASH_COMMAND_DEFS.map(cmd => materializeTuiBuiltinSlashCommand(cmd, runtime));
}

/**
 * Unified registry exposed for cross-mode tooling. Each spec carries at least
 * one of `handle` / `handleTui`. The TUI dispatcher prefers `handleTui`; the
 * ACP dispatcher requires `handle` and skips TUI-only entries.
 */
export const BUILTIN_SLASH_COMMANDS_INTERNAL: ReadonlyArray<SlashCommandSpec> = BUILTIN_SLASH_COMMAND_REGISTRY;

/**
 * Execute a builtin slash command in the interactive TUI.
 *
 * Returns `false` when no builtin matched. Returns `true` when a command
 * consumed the input entirely. Returns a `string` when the command was handled
 * but remaining text should be sent as a prompt.
 */
export async function executeBuiltinSlashCommand(
	text: string,
	runtime: BuiltinSlashCommandRuntime,
): Promise<string | boolean> {
	const parsed = parseSlashCommand(text);
	if (!parsed) return false;

	const command = BUILTIN_SLASH_COMMAND_LOOKUP.get(parsed.name);
	if (!command) return false;
	if (parsed.args.length > 0 && !command.allowArgs) {
		return false;
	}
	// Collab guests run a read-mostly replica: session-mutating builtins are
	// host-only; the allowlist covers purely local/read-only commands.
	if (runtime.ctx.collabGuest && !COLLAB_GUEST_ALLOWED_COMMANDS[command.name]) {
		runtime.ctx.showStatus(`/${command.name} is host-only during a collab session`);
		clearSubmittedText(runtime);
		return true;
	}
	if (command.handleTui) {
		const result = await command.handleTui(parsed, runtime);
		if (result && typeof result === "object" && "prompt" in result) return result.prompt;
		return true;
	}
	if (command.handle) {
		// No TUI-specific override → adapt the ACP/text-mode `handle` to the
		// TUI by routing `runtime.output` through `ctx.showStatus`, clearing
		// the editor after the call, and reusing the active session's plugin
		// reload pipeline. Spec authors get a single body usable from either
		// dispatcher without forcing every TUI test to construct the full
		// `SlashCommandRuntime` shape.
		const ctx = runtime.ctx;
		const adapted: SlashCommandRuntime = {
			session: ctx.session,
			sessionManager: ctx.sessionManager,
			settings: ctx.settings,
			cwd: ctx.sessionManager.getCwd(),
			output: (text: string) => {
				ctx.showStatus(text);
			},
			refreshCommands: () => ctx.refreshSlashCommandState(),
			reloadPlugins: () => reloadTuiPluginState(ctx),
		};
		const result = await command.handle(parsed, adapted);
		clearSubmittedText(runtime);
		if (result && typeof result === "object" && "prompt" in result) return result.prompt;
		return true;
	}
	return false;
}

/** Look up a unified spec by name or alias. Used by the ACP dispatcher. */
export function lookupBuiltinSlashCommand(name: string): SlashCommandSpec | undefined {
	return BUILTIN_SLASH_COMMAND_LOOKUP.get(name);
}

export type { ParsedSlashCommand, SlashCommandResult, SlashCommandRuntime, SlashCommandSpec, TuiSlashCommandRuntime };
