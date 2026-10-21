import * as path from "node:path";
import { getAgentDir, getConfigRootDir, getPluginsDir, getPluginsNodeModules, pathIsWithin } from "@oh-my-pi/pi-utils";

// Discovery scans the real user agent dir AND walks installed plugins (pi-context, etc.)
// regardless of the test's tempDir cwd. Strip both so tests assert only on extensions
// they themselves wrote into tempDir.
function userScopedDirs(): string[] {
	return [path.join(getAgentDir(), "extensions"), getPluginsNodeModules()];
}

function isUserScoped(p: string): boolean {
	return userScopedDirs().some(dir => p.startsWith(dir));
}

export function filterUserScoped<T extends { path: string }>(items: T[], keepRoots?: string | string[]): T[] {
	if (keepRoots) {
		const roots = Array.isArray(keepRoots) ? keepRoots : [keepRoots];
		return items.filter(it => roots.some(root => pathIsWithin(root, it.path)));
	}
	const prefixes = [getConfigRootDir(), getAgentDir(), getPluginsDir()];
	return items.filter(it => !prefixes.some(prefix => pathIsWithin(prefix, it.path)));
}

export function filterUserExtensions<T extends { path: string }>(extensions: T[]): T[] {
	return extensions.filter(ext => !isUserScoped(ext.path));
}

export function filterUserExtensionErrors<T extends { path: string }>(errors: T[]): T[] {
	return errors.filter(err => !isUserScoped(err.path));
}
