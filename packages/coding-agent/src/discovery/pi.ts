/**
 * Pi Provider (.pi)
 *
 * Loads configuration from .pi directories.
 * Priority: 90 (between native/OMP at 100 and Claude Code at 80)
 */
import * as path from "node:path";
import { hasFsCode, tryParseJson } from "@oh-my-pi/pi-utils";
import { registerProvider } from "../capability";
import { type ContextFile, contextFileCapability } from "../capability/context-file";
import { type ExtensionModule, extensionModuleCapability } from "../capability/extension-module";
import { readFile } from "../capability/fs";
import { type Hook, hookCapability } from "../capability/hook";
import { type MCPServer, mcpCapability } from "../capability/mcp";
import { type Settings, settingsCapability } from "../capability/settings";
import { type Skill, skillCapability } from "../capability/skill";
import { type SlashCommand, slashCommandCapability } from "../capability/slash-command";
import { type SystemPrompt, systemPromptCapability } from "../capability/system-prompt";
import { type CustomTool, toolCapability } from "../capability/tool";
import type { LoadContext, LoadResult } from "../capability/types";
import {
	calculateDepth,
	createSourceMeta,
	discoverExtensionModulePaths,
	expandEnvVarsDeep,
	getExtensionNameFromPath,
	loadFilesFromDir,
	scanSkillsFromDir,
} from "./helpers";

const PROVIDER_ID = "pi";
const DISPLAY_NAME = "Pi";
const PRIORITY = 90;
const CONFIG_DIR = ".pi";
const AGENT_DIR = ".pi/agent";

function getUserPi(ctx: LoadContext): string {
	return path.join(ctx.home, AGENT_DIR);
}

function getProjectPi(ctx: LoadContext): string {
	return path.join(ctx.cwd, CONFIG_DIR);
}

function isMissingDirectoryError(error: unknown): boolean {
	return hasFsCode(error, "ENOENT") || hasFsCode(error, "ENOTDIR");
}

// =============================================================================
// MCP Servers
// =============================================================================

async function loadMCPServers(ctx: LoadContext): Promise<LoadResult<MCPServer>> {
	const items: MCPServer[] = [];
	const warnings: string[] = [];

	const userBase = getUserPi(ctx);
	const userMcpJson = path.join(userBase, "mcp.json");

	const projectBase = getProjectPi(ctx);
	const projectMcpJson = path.join(projectBase, "mcp.json");
	const projectMcpJsonAlt = path.join(projectBase, ".mcp.json");

	const userPaths = [{ path: userMcpJson, level: "user" as const }];
	const projectPaths = [
		{ path: projectMcpJson, level: "project" as const },
		{ path: projectMcpJsonAlt, level: "project" as const },
	];

	const allPaths = [...userPaths, ...projectPaths];
	const contents = await Promise.all(allPaths.map(({ path }) => readFile(path)));

	const parseMcpServers = (content: string | null, filePath: string, level: "user" | "project"): MCPServer[] => {
		if (!content) return [];
		const json = tryParseJson<{ mcpServers?: Record<string, unknown> }>(content);
		if (!json?.mcpServers) return [];

		const mcpServers = expandEnvVarsDeep(json.mcpServers);
		return Object.entries(mcpServers).map(([name, config]) => {
			const serverConfig = config as Record<string, unknown>;
			return {
				name,
				timeout: typeof serverConfig.timeout === "number" ? serverConfig.timeout : undefined,
				command: serverConfig.command as string | undefined,
				args: serverConfig.args as string[] | undefined,
				env: serverConfig.env as Record<string, string> | undefined,
				url: serverConfig.url as string | undefined,
				headers: serverConfig.headers as Record<string, string> | undefined,
				transport: serverConfig.type as "stdio" | "sse" | "http" | undefined,
				_source: createSourceMeta(PROVIDER_ID, filePath, level),
			};
		});
	};

	for (let i = 0; i < userPaths.length; i++) {
		const servers = parseMcpServers(contents[i], userPaths[i].path, userPaths[i].level);
		if (servers.length > 0) {
			items.push(...servers);
			break;
		}
	}

	const projectOffset = userPaths.length;
	for (let i = 0; i < projectPaths.length; i++) {
		const servers = parseMcpServers(contents[projectOffset + i], projectPaths[i].path, projectPaths[i].level);
		if (servers.length > 0) {
			items.push(...servers);
			break;
		}
	}

	return { items, warnings };
}

// =============================================================================
// Context Files (PI.md)
// =============================================================================

async function loadContextFiles(ctx: LoadContext): Promise<LoadResult<ContextFile>> {
	const items: ContextFile[] = [];
	const warnings: string[] = [];

	const userBase = getUserPi(ctx);
	const userPiMd = path.join(userBase, "PI.md");

	const userContent = await readFile(userPiMd);
	if (userContent !== null) {
		items.push({
			path: userPiMd,
			content: userContent,
			level: "user",
			_source: createSourceMeta(PROVIDER_ID, userPiMd, "user"),
		});
	}

	const projectBase = getProjectPi(ctx);
	const projectPiMd = path.join(projectBase, "PI.md");
	const projectContent = await readFile(projectPiMd);
	if (projectContent !== null) {
		const depth = calculateDepth(ctx.cwd, path.dirname(projectBase), path.sep);
		items.push({
			path: projectPiMd,
			content: projectContent,
			level: "project",
			depth,
			_source: createSourceMeta(PROVIDER_ID, projectPiMd, "project"),
		});
	}

	return { items, warnings };
}

// =============================================================================
// Skills
// =============================================================================

async function loadSkills(ctx: LoadContext): Promise<LoadResult<Skill>> {
	const userSkillsDir = path.join(getUserPi(ctx), "skills");

	// Walk up from cwd finding .pi/skills/ in ancestors
	const projectScans: Promise<LoadResult<Skill>>[] = [];
	let current = ctx.cwd;
	while (true) {
		projectScans.push(
			scanSkillsFromDir(ctx, {
				dir: path.join(current, CONFIG_DIR, "skills"),
				providerId: PROVIDER_ID,
				level: "project",
			}),
		);
		if (current === (ctx.repoRoot ?? ctx.home)) break;
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}

	const [userResult, ...projectResults] = await Promise.allSettled([
		scanSkillsFromDir(ctx, { dir: userSkillsDir, providerId: PROVIDER_ID, level: "user" }),
		...projectScans,
	]);

	const items: Skill[] = [];
	const warnings: string[] = [];

	if (userResult.status === "fulfilled") {
		items.push(...userResult.value.items);
		warnings.push(...(userResult.value.warnings ?? []));
	} else if (!isMissingDirectoryError(userResult.reason)) {
		warnings.push(`Failed to scan Pi user skills in ${userSkillsDir}: ${String(userResult.reason)}`);
	}

	for (const projectResult of projectResults) {
		if (projectResult.status === "fulfilled") {
			items.push(...projectResult.value.items);
			warnings.push(...(projectResult.value.warnings ?? []));
		} else if (!isMissingDirectoryError(projectResult.reason)) {
			warnings.push(`Failed to scan Pi project skills: ${String(projectResult.reason)}`);
		}
	}

	return { items, warnings };
}

// =============================================================================
// Extension Modules
// =============================================================================

async function loadExtensionModules(ctx: LoadContext): Promise<LoadResult<ExtensionModule>> {
	const items: ExtensionModule[] = [];
	const warnings: string[] = [];

	const userBase = getUserPi(ctx);
	const userExtensionsDir = path.join(userBase, "extensions");
	const projectExtensionsDir = path.join(ctx.cwd, CONFIG_DIR, "extensions");

	const dirsToDiscover: { dir: string; level: "user" | "project" }[] = [
		{ dir: userExtensionsDir, level: "user" },
		{ dir: projectExtensionsDir, level: "project" },
	];

	const pathsByLevel = await Promise.all(
		dirsToDiscover.map(async ({ dir, level }) => {
			const paths = await discoverExtensionModulePaths(ctx, dir);
			return paths.map(extPath => ({ extPath, level }));
		}),
	);

	for (const extensions of pathsByLevel) {
		for (const { extPath, level } of extensions) {
			items.push({
				name: getExtensionNameFromPath(extPath),
				path: extPath,
				level,
				_source: createSourceMeta(PROVIDER_ID, extPath, level),
			});
		}
	}

	return { items, warnings };
}

// =============================================================================
// Slash Commands
// =============================================================================

async function loadSlashCommands(ctx: LoadContext): Promise<LoadResult<SlashCommand>> {
	const items: SlashCommand[] = [];
	const warnings: string[] = [];

	const userBase = getUserPi(ctx);
	const userCommandsDir = path.join(userBase, "commands");

	const userResult = await loadFilesFromDir<SlashCommand>(ctx, userCommandsDir, PROVIDER_ID, "user", {
		extensions: ["md"],
		transform: (name, content, filePath, source) => {
			const cmdName = name.replace(/\.md$/, "");
			return {
				name: cmdName,
				path: filePath,
				content,
				level: "user",
				_source: source,
			};
		},
	});

	items.push(...userResult.items);
	if (userResult.warnings) warnings.push(...userResult.warnings);

	const projectCommandsDir = path.join(ctx.cwd, CONFIG_DIR, "commands");

	const projectResult = await loadFilesFromDir<SlashCommand>(ctx, projectCommandsDir, PROVIDER_ID, "project", {
		extensions: ["md"],
		transform: (name, content, filePath, source) => {
			const cmdName = name.replace(/\.md$/, "");
			return {
				name: cmdName,
				path: filePath,
				content,
				level: "project",
				_source: source,
			};
		},
	});

	items.push(...projectResult.items);
	if (projectResult.warnings) warnings.push(...projectResult.warnings);

	return { items, warnings };
}

// =============================================================================
// Hooks
// =============================================================================

async function loadHooks(ctx: LoadContext): Promise<LoadResult<Hook>> {
	const items: Hook[] = [];
	const warnings: string[] = [];

	const userBase = getUserPi(ctx);
	const userHooksDir = path.join(userBase, "hooks");
	const projectBase = getProjectPi(ctx);
	const projectHooksDir = path.join(projectBase, "hooks");

	const hookTypes = ["pre", "post"] as const;

	const loadTasks: { dir: string; hookType: "pre" | "post"; level: "user" | "project" }[] = [];
	for (const hookType of hookTypes) {
		loadTasks.push({ dir: path.join(userHooksDir, hookType), hookType, level: "user" });
	}
	for (const hookType of hookTypes) {
		loadTasks.push({ dir: path.join(projectHooksDir, hookType), hookType, level: "project" });
	}

	const results = await Promise.all(
		loadTasks.map(({ dir, hookType, level }) =>
			loadFilesFromDir<Hook>(ctx, dir, PROVIDER_ID, level, {
				transform: (name, _content, filePath, source) => {
					const toolName = name.replace(/\.(sh|bash|zsh|fish)$/, "");
					return {
						name,
						path: filePath,
						type: hookType,
						tool: toolName,
						level,
						_source: source,
					};
				},
			}),
		),
	);

	for (const result of results) {
		items.push(...result.items);
		if (result.warnings) warnings.push(...result.warnings);
	}

	return { items, warnings };
}

// =============================================================================
// Custom Tools
// =============================================================================

async function loadTools(ctx: LoadContext): Promise<LoadResult<CustomTool>> {
	const items: LoadResult<CustomTool>["items"] = [];
	const warnings: string[] = [];

	const userBase = getUserPi(ctx);
	const userToolsDir = path.join(userBase, "tools");

	const userResult = await loadFilesFromDir<CustomTool>(ctx, userToolsDir, PROVIDER_ID, "user", {
		transform: (name, _content, filePath, source) => {
			const toolName = name.replace(/\.(ts|js|sh|bash|py)$/, "");
			return {
				name: toolName,
				path: filePath,
				description: `${toolName} custom tool`,
				level: "user",
				_source: source,
			};
		},
	});

	items.push(...userResult.items);
	if (userResult.warnings) warnings.push(...userResult.warnings);

	const projectBase = getProjectPi(ctx);
	const projectToolsDir = path.join(projectBase, "tools");

	const projectResult = await loadFilesFromDir<CustomTool>(ctx, projectToolsDir, PROVIDER_ID, "project", {
		transform: (name, _content, filePath, source) => {
			const toolName = name.replace(/\.(ts|js|sh|bash|py)$/, "");
			return {
				name: toolName,
				path: filePath,
				description: `${toolName} custom tool`,
				level: "project",
				_source: source,
			};
		},
	});

	items.push(...projectResult.items);
	if (projectResult.warnings) warnings.push(...projectResult.warnings);

	return { items, warnings };
}

// =============================================================================
// System Prompts
// =============================================================================

async function loadSystemPrompts(ctx: LoadContext): Promise<LoadResult<SystemPrompt>> {
	const items: SystemPrompt[] = [];
	const warnings: string[] = [];

	const userBase = getUserPi(ctx);
	const userSystemMd = path.join(userBase, "SYSTEM.md");

	const content = await readFile(userSystemMd);
	if (content !== null) {
		items.push({
			path: userSystemMd,
			content,
			level: "user",
			_source: createSourceMeta(PROVIDER_ID, userSystemMd, "user"),
		});
	}

	return { items, warnings };
}

// =============================================================================
// Settings
// =============================================================================

async function loadSettings(ctx: LoadContext): Promise<LoadResult<Settings>> {
	const items: Settings[] = [];
	const warnings: string[] = [];

	const userBase = getUserPi(ctx);
	const userSettingsJson = path.join(userBase, "settings.json");

	const userContent = await readFile(userSettingsJson);
	if (userContent) {
		const data = tryParseJson<Record<string, unknown>>(userContent);
		if (data) {
			items.push({
				path: userSettingsJson,
				data,
				level: "user",
				_source: createSourceMeta(PROVIDER_ID, userSettingsJson, "user"),
			});
		} else {
			warnings.push(`Failed to parse JSON in ${userSettingsJson}`);
		}
	}

	const projectBase = getProjectPi(ctx);
	const projectSettingsJson = path.join(projectBase, "settings.json");
	const projectContent = await readFile(projectSettingsJson);
	if (projectContent) {
		const data = tryParseJson<Record<string, unknown>>(projectContent);
		if (data) {
			items.push({
				path: projectSettingsJson,
				data,
				level: "project",
				_source: createSourceMeta(PROVIDER_ID, projectSettingsJson, "project"),
			});
		} else {
			warnings.push(`Failed to parse JSON in ${projectSettingsJson}`);
		}
	}

	return { items, warnings };
}

// =============================================================================
// Provider Registration
// =============================================================================

registerProvider<MCPServer>(mcpCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load MCP servers from .pi/agent/mcp.json",
	priority: PRIORITY,
	load: loadMCPServers,
});

registerProvider<ContextFile>(contextFileCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load PI.md files from .pi/agent/ and .pi/",
	priority: PRIORITY,
	load: loadContextFiles,
});

registerProvider<Skill>(skillCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load skills from .pi/agent/skills/*/SKILL.md and .pi/skills/*/SKILL.md",
	priority: PRIORITY,
	load: loadSkills,
});

registerProvider<ExtensionModule>(extensionModuleCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load extension modules from .pi/agent/extensions and .pi/extensions",
	priority: PRIORITY,
	load: loadExtensionModules,
});

registerProvider<SlashCommand>(slashCommandCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load slash commands from .pi/agent/commands/*.md and .pi/commands/*.md",
	priority: PRIORITY,
	load: loadSlashCommands,
});

registerProvider<Hook>(hookCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load hooks from .pi/agent/hooks/pre/ and .pi/agent/hooks/post/",
	priority: PRIORITY,
	load: loadHooks,
});

registerProvider<CustomTool>(toolCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load custom tools from .pi/agent/tools/ and .pi/tools/",
	priority: PRIORITY,
	load: loadTools,
});

registerProvider<Settings>(settingsCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load settings from .pi/agent/settings.json and .pi/settings.json",
	priority: PRIORITY,
	load: loadSettings,
});

registerProvider<SystemPrompt>(systemPromptCapability.id, {
	id: PROVIDER_ID,
	displayName: DISPLAY_NAME,
	description: "Load system prompt from .pi/agent/SYSTEM.md",
	priority: PRIORITY,
	load: loadSystemPrompts,
});
