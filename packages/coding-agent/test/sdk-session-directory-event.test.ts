/**
 * `session_directory` extension event (openspec/specs/session-directory-event).
 *
 * The CLI loads extensions before `createAgentSession` runs and hands the
 * result back through `preloadedExtensions`. A `session_directory` handler MAY
 * return `{ sessionDir }` to redirect where the session stores its files. The
 * contract:
 *
 * - fired once, before the session manager is created, carrying
 *   `{ type: "session_directory"; cwd }`;
 * - the last handler to return a non-empty `sessionDir` wins; empty returns
 *   are ignored; no handler keeps the default directory;
 * - an explicit host choice (`options.sessionManager` — how main.ts threads
 *   `--session-dir` through) wins outright and suppresses the event;
 * - the SDK path (extensions loaded inside `createAgentSession`, after
 *   session-manager construction) never fires it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ExtensionFactory } from "@oh-my-pi/pi-coding-agent/extensibility/extensions";
import { loadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import { type CreateAgentSessionOptions, createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { removeSyncWithRetries, Snowflake } from "@oh-my-pi/pi-utils";

describe("session_directory extension event", () => {
	const tempDirs: string[] = [];
	let sharedAuthStorage: AuthStorage;
	let sharedModelRegistry: ModelRegistry;

	beforeAll(async () => {
		sharedAuthStorage = await AuthStorage.create(":memory:");
		sharedModelRegistry = new ModelRegistry(sharedAuthStorage);
	});

	afterAll(() => {
		sharedAuthStorage.close();
	});

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			removeSyncWithRetries(tempDir);
		}
	});

	interface Workspace {
		tempDir: string;
		cwd: string;
		agentDir: string;
		extensionsDir: string;
		marker: string;
	}

	function makeWorkspace(): Workspace {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `pi-session-dir-event-${Snowflake.next()}-`));
		tempDirs.push(tempDir);
		const cwd = path.join(tempDir, "project");
		const agentDir = path.join(tempDir, "agent");
		fs.mkdirSync(cwd, { recursive: true });
		return {
			tempDir,
			cwd,
			agentDir,
			extensionsDir: path.join(tempDir, "extensions"),
			marker: path.join(tempDir, "fired.log"),
		};
	}

	/**
	 * Write an extension module registering a `session_directory` handler that
	 * appends `event.type|event.cwd` to the marker file on every invocation and
	 * returns `{ sessionDir }` when `sessionDir` is provided.
	 */
	function writeSessionDirectoryExtension(workspace: Workspace, name: string, sessionDir?: string): string {
		fs.mkdirSync(workspace.extensionsDir, { recursive: true });
		const file = path.join(workspace.extensionsDir, name);
		const lines = [
			`import { appendFileSync } from "node:fs";`,
			`export default function (pi) {`,
			`\tpi.on("session_directory", event => {`,
			`\t\tappendFileSync(${JSON.stringify(workspace.marker)}, event.type + "|" + event.cwd + "\\n");`,
			sessionDir === undefined ? `\t\treturn;` : `\t\treturn { sessionDir: ${JSON.stringify(sessionDir)} };`,
			`\t});`,
			`}`,
			``,
		];
		fs.writeFileSync(file, lines.join("\n"));
		return file;
	}

	function readMarkerLines(workspace: Workspace): string[] {
		if (!fs.existsSync(workspace.marker)) return [];
		return fs.readFileSync(workspace.marker, "utf8").trim().split("\n").filter(Boolean);
	}

	async function createSession(workspace: Workspace, extra: Partial<CreateAgentSessionOptions>) {
		const result = await createAgentSession({
			cwd: workspace.cwd,
			agentDir: workspace.agentDir,
			modelRegistry: sharedModelRegistry,
			settings: Settings.isolated(),
			disableExtensionDiscovery: true,
			skills: [],
			rules: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			preloadedCustomToolPaths: [],
			enableMCP: false,
			enableLsp: false,
			skipPythonPreflight: true,
			...extra,
		});
		if (!result.session.sessionFile) throw new Error("Expected a persisted session file");
		return result;
	}

	it("redirects session storage to the handler's sessionDir", async () => {
		const workspace = makeWorkspace();
		const redirected = path.join(workspace.tempDir, "redirected-sessions");
		const extensionFile = writeSessionDirectoryExtension(workspace, "redirect.ts", redirected);
		const preloaded = await loadExtensions([extensionFile], workspace.cwd);

		const { session } = await createSession(workspace, { preloadedExtensions: preloaded });
		try {
			const sessionFile = session.sessionFile as string;
			expect(path.dirname(sessionFile)).toBe(path.resolve(redirected));
			// The handler ran exactly once and received the event object.
			expect(readMarkerLines(workspace)).toEqual([`session_directory|${workspace.cwd}`]);
		} finally {
			await session.dispose();
		}
	});

	it("uses the last non-empty sessionDir when multiple handlers respond", async () => {
		const workspace = makeWorkspace();
		const firstDir = path.join(workspace.tempDir, "first-sessions");
		const secondDir = path.join(workspace.tempDir, "second-sessions");
		const preloaded = await loadExtensions(
			[
				writeSessionDirectoryExtension(workspace, "first.ts", firstDir),
				writeSessionDirectoryExtension(workspace, "second.ts", secondDir),
			],
			workspace.cwd,
		);

		const { session } = await createSession(workspace, { preloadedExtensions: preloaded });
		try {
			expect(path.dirname(session.sessionFile as string)).toBe(path.resolve(secondDir));
		} finally {
			await session.dispose();
		}
	});

	it("ignores handlers that return an empty sessionDir", async () => {
		const workspace = makeWorkspace();
		const firstDir = path.join(workspace.tempDir, "first-sessions");
		const preloaded = await loadExtensions(
			[
				writeSessionDirectoryExtension(workspace, "first.ts", firstDir),
				writeSessionDirectoryExtension(workspace, "empty.ts", ""),
			],
			workspace.cwd,
		);

		const { session } = await createSession(workspace, { preloadedExtensions: preloaded });
		try {
			expect(path.dirname(session.sessionFile as string)).toBe(path.resolve(firstDir));
		} finally {
			await session.dispose();
		}
	});

	it("keeps the default session directory when no handler responds", async () => {
		const workspace = makeWorkspace();
		const extensionFile = path.join(workspace.extensionsDir, "no-handler.ts");
		fs.mkdirSync(workspace.extensionsDir, { recursive: true });
		fs.writeFileSync(extensionFile, `export default function (pi) {\n\tpi.on("agent_start", () => {});\n}\n`);
		const preloaded = await loadExtensions([extensionFile], workspace.cwd);

		const { session } = await createSession(workspace, { preloadedExtensions: preloaded });
		try {
			const sessionFile = session.sessionFile as string;
			expect(path.dirname(sessionFile)).toBe(
				path.resolve(SessionManager.getDefaultSessionDir(workspace.cwd, workspace.agentDir)),
			);
			expect(readMarkerLines(workspace)).toEqual([]);
		} finally {
			await session.dispose();
		}
	});

	it("lets an explicit sessionManager (the --session-dir thread-through) override the handler", async () => {
		const workspace = makeWorkspace();
		const redirected = path.join(workspace.tempDir, "redirected-sessions");
		const explicitDir = path.join(workspace.tempDir, "explicit-sessions");
		const extensionFile = writeSessionDirectoryExtension(workspace, "redirect.ts", redirected);
		const preloaded = await loadExtensions([extensionFile], workspace.cwd);

		const { session } = await createSession(workspace, {
			preloadedExtensions: preloaded,
			sessionManager: SessionManager.create(workspace.cwd, explicitDir),
		});
		try {
			expect(path.dirname(session.sessionFile as string)).toBe(path.resolve(explicitDir));
		} finally {
			await session.dispose();
		}
	});

	it("does not invoke session_directory handlers when the host supplied the session manager", async () => {
		const workspace = makeWorkspace();
		const redirected = path.join(workspace.tempDir, "redirected-sessions");
		const explicitDir = path.join(workspace.tempDir, "explicit-sessions");
		const extensionFile = writeSessionDirectoryExtension(workspace, "redirect.ts", redirected);
		const preloaded = await loadExtensions([extensionFile], workspace.cwd);

		const { session } = await createSession(workspace, {
			preloadedExtensions: preloaded,
			sessionManager: SessionManager.create(workspace.cwd, explicitDir),
		});
		try {
			expect(readMarkerLines(workspace)).toEqual([]);
		} finally {
			await session.dispose();
		}
	});

	it("does not fire session_directory on the SDK path (extensions loaded after session-manager construction)", async () => {
		const workspace = makeWorkspace();
		const redirected = path.join(workspace.tempDir, "redirected-sessions");
		let factoryRan = false;
		const sdkExtension: ExtensionFactory = pi => {
			factoryRan = true;
			pi.on("session_directory", event => {
				fs.appendFileSync(workspace.marker, `${event.type}|${event.cwd}\n`);
				return { sessionDir: redirected };
			});
		};

		const { session, extensionsResult } = await createSession(workspace, { extensions: [sdkExtension] });
		try {
			// The factory really ran and registered the handler — it just fired too
			// late (after the manager was built) to redirect anything.
			expect(factoryRan).toBe(true);
			expect(extensionsResult.extensions.some(ext => ext.handlers.has("session_directory"))).toBe(true);
			expect(readMarkerLines(workspace)).toEqual([]);
			expect(path.dirname(session.sessionFile as string)).toBe(
				path.resolve(SessionManager.getDefaultSessionDir(workspace.cwd, workspace.agentDir)),
			);
		} finally {
			await session.dispose();
		}
	});
});
