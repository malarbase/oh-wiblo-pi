import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getPluginsDir, getProjectDir, isEnoent } from "@oh-my-pi/pi-utils";
import { extractPackageName } from "./parser";
import type { InstalledPlugin } from "./types";

const PLUGINS_DIR = getPluginsDir();

// Valid npm package name pattern (scoped and unscoped)
const VALID_PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[a-z0-9-._^~>=<]+)?$/i;

/**
 * Validate package name to prevent command injection
 */
function validatePackageName(name: string): void {
	if (!VALID_PACKAGE_NAME.test(name)) {
		throw new Error(`Invalid package name: ${name}`);
	}
	// Extra safety: no shell metacharacters
	if (/[;&|`$(){}[\]<>\\]/.test(name)) {
		throw new Error(`Invalid characters in package name: ${name}`);
	}
}

/**
 * Packages that plugins may import under either the @oh-my-pi/* or @mariozechner/* name.
 *
 * Bun resolves dynamic imports relative to the importer's on-disk location. Plugins
 * live under ~/.omp/plugins/node_modules/, which is a separate filesystem tree from
 * both the omp workspace and the global bun install. Neither @oh-my-pi/* nor
 * @mariozechner/* packages are visible from there through normal node_modules walk-up.
 *
 * The fix: symlink both name variants into ~/.omp/plugins/node_modules/ so the
 * walk-up from any plugin source file finds them. import.meta.resolve() is called
 * from within the running omp process, so it finds the same packages omp itself uses.
 */
const OMP_PACKAGE_NAMES = ["pi-coding-agent", "pi-tui", "pi-ai", "pi-agent-core", "pi-utils", "pi-natives"] as const;

/**
 * Resolve the on-disk directory for each @oh-my-pi/* package using the running
 * process's module resolution (same packages omp itself is built against).
 * Returns a map of short name → absolute directory path.
 */
async function resolveOmpPackageDirs(): Promise<Map<string, string>> {
	const dirs = new Map<string, string>();
	for (const name of OMP_PACKAGE_NAMES) {
		try {
			// import.meta.resolve returns the entry-point file; we want the package root.
			const entryUrl = import.meta.resolve(`@oh-my-pi/${name}`);
			const entryPath = new URL(entryUrl).pathname;
			// Walk up until we find a directory containing package.json.
			let dir = path.dirname(entryPath);
			while (dir !== path.dirname(dir)) {
				try {
					await fs.stat(path.join(dir, "package.json"));
					break;
				} catch {
					dir = path.dirname(dir);
				}
			}
			dirs.set(name, dir);
		} catch {
			// Package not available in this build — skip.
		}
	}
	return dirs;
}

/**
 * Create or update a symlink at linkPath → target.
 * Replaces any existing symlink or empty directory; skips if already correct.
 */
async function upsertSymlink(target: string, linkPath: string): Promise<void> {
	try {
		const existing = await fs.readlink(linkPath);
		if (existing === target) return; // already correct
		await fs.unlink(linkPath);
	} catch (err) {
		if (!isEnoent(err)) {
			// Not a symlink — try to remove as directory/file.
			try {
				await fs.rm(linkPath, { recursive: true });
			} catch {
				/* ignore */
			}
		}
	}
	await fs.symlink(target, linkPath);
}

/**
 * Ensure the plugins directory and its node_modules subdirectory exist.
 */
async function ensurePluginsDir(): Promise<void> {
	await fs.mkdir(PLUGINS_DIR, { recursive: true });
	await fs.mkdir(path.join(PLUGINS_DIR, "node_modules"), { recursive: true });
}

/**
 * Ensure ~/.omp/plugins/package.json exists and that @oh-my-pi/* and @mariozechner/*
 * packages are symlinked into node_modules so plugin extensions can import them.
 * Called before every install/link so existing setups are upgraded in place.
 */
export async function ensurePluginsManifest(): Promise<void> {
	const pkgJsonPath = path.join(PLUGINS_DIR, "package.json");
	let manifest: Record<string, unknown> = { name: "omp-plugins", private: true, dependencies: {} };
	try {
		manifest = await Bun.file(pkgJsonPath).json();
	} catch (err) {
		if (!isEnoent(err)) throw err;
	}

	if (!manifest.dependencies) {
		manifest.dependencies = {};
		await Bun.write(pkgJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
	}

	// Symlink @oh-my-pi/* and @mariozechner/* packages so plugins can import either name.
	const packageDirs = await resolveOmpPackageDirs();
	const nodeModules = path.join(PLUGINS_DIR, "node_modules");
	const ompScope = path.join(nodeModules, "@oh-my-pi");
	const mariozechnerScope = path.join(nodeModules, "@mariozechner");
	await fs.mkdir(ompScope, { recursive: true });
	await fs.mkdir(mariozechnerScope, { recursive: true });

	for (const [name, dir] of packageDirs) {
		await upsertSymlink(dir, path.join(ompScope, name));
		await upsertSymlink(dir, path.join(mariozechnerScope, name));
	}
}

export async function installPlugin(packageName: string): Promise<InstalledPlugin> {
	// Validate package name to prevent command injection
	validatePackageName(packageName);

	// Ensure plugins directory exists
	await ensurePluginsDir();

	// Ensure package.json exists and carries upstream package aliases.
	await ensurePluginsManifest();

	// Run npm install in plugins directory
	const proc = Bun.spawn(["bun", "install", packageName], {
		cwd: PLUGINS_DIR,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		windowsHide: true,
	});

	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`Failed to install ${packageName}: ${stderr}`);
	}

	// Extract the actual package name (without version specifier) for path lookup
	const actualName = extractPackageName(packageName);

	// Read the installed package's package.json
	const pkgPath = path.join(PLUGINS_DIR, "node_modules", actualName, "package.json");
	const pkgFile = Bun.file(pkgPath);
	if (!(await pkgFile.exists())) {
		throw new Error(`Package installed but package.json not found at ${pkgPath}`);
	}

	const pkg = await pkgFile.json();

	return {
		name: pkg.name,
		version: pkg.version,
		path: path.join(PLUGINS_DIR, "node_modules", actualName),
		manifest: pkg.omp || pkg.pi || { version: pkg.version },
		enabledFeatures: null,
		enabled: true,
	};
}

export async function uninstallPlugin(name: string): Promise<void> {
	// Validate package name
	validatePackageName(name);

	await ensurePluginsDir();

	const proc = Bun.spawn(["bun", "uninstall", name], {
		cwd: PLUGINS_DIR,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		windowsHide: true,
	});

	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`Failed to uninstall ${name}`);
	}
}

export async function listPlugins(): Promise<InstalledPlugin[]> {
	const pkgJsonPath = Bun.file(path.join(PLUGINS_DIR, "package.json"));
	if (!(await pkgJsonPath.exists())) {
		return [];
	}

	const pkg = await pkgJsonPath.json();
	const deps = pkg.dependencies || {};

	const plugins: InstalledPlugin[] = [];
	for (const [name, _version] of Object.entries(deps)) {
		const pluginPath = path.join(PLUGINS_DIR, "node_modules", name);
		const fpkg = Bun.file(path.join(pluginPath, "package.json"));
		if (await fpkg.exists()) {
			const pkg = await fpkg.json();
			plugins.push({
				name,
				version: pkg.version,
				path: pluginPath,
				manifest: pkg.omp || pkg.pi || { version: pkg.version },
				enabledFeatures: null,
				enabled: true,
			});
		}
	}

	return plugins;
}

export async function linkPlugin(localPath: string): Promise<void> {
	const cwd = getProjectDir();
	const absolutePath = path.resolve(cwd, localPath);

	// Validate that resolved path is within cwd to prevent path traversal
	const normalizedCwd = path.resolve(cwd);
	const normalizedPath = path.resolve(absolutePath);
	if (!normalizedPath.startsWith(`${normalizedCwd}/`) && normalizedPath !== normalizedCwd) {
		throw new Error(`Invalid path: ${localPath} resolves outside working directory`);
	}

	// Validate package.json exists
	const pkgFile = Bun.file(path.join(absolutePath, "package.json"));
	if (!(await pkgFile.exists())) {
		throw new Error(`package.json not found at ${absolutePath}`);
	}

	let pkg: { name?: string };
	try {
		pkg = await pkgFile.json();
	} catch (err) {
		throw new Error(`Invalid package.json at ${absolutePath}: ${err}`);
	}

	if (!pkg.name || typeof pkg.name !== "string") {
		throw new Error("package.json must have a valid name field");
	}

	// Validate package name to prevent path traversal via pkg.name
	if (pkg.name.includes("..") || pkg.name.includes("/") || pkg.name.includes("\\")) {
		// Exception: scoped packages have one slash
		if (!pkg.name.startsWith("@") || (pkg.name.match(/\//g) || []).length !== 1) {
			throw new Error(`Invalid package name in package.json: ${pkg.name}`);
		}
	}

	await ensurePluginsManifest();

	// Create symlink in plugins/node_modules
	const linkPath = path.join(PLUGINS_DIR, "node_modules", pkg.name);

	// For scoped packages, ensure the scope directory exists
	if (pkg.name.startsWith("@")) {
		const scopeDir = path.join(PLUGINS_DIR, "node_modules", pkg.name.split("/")[0]);
		await fs.mkdir(scopeDir, { recursive: true });
	}

	// Remove existing if present
	try {
		const stats = await fs.lstat(linkPath);
		if (stats.isSymbolicLink() || stats.isDirectory()) {
			await fs.unlink(linkPath);
		}
	} catch (err) {
		if (!isEnoent(err)) throw err;
	}

	// Create symlink using fs instead of shell command
	await fs.symlink(absolutePath, linkPath);
}
