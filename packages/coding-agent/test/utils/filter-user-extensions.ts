import * as path from "node:path";
import { getAgentDir, getPluginsNodeModules } from "@oh-my-pi/pi-utils";

// Discovery scans the real user agent dir AND walks installed plugins (pi-context, etc.)
// regardless of the test's tempDir cwd. Strip both so tests assert only on extensions
// they themselves wrote into tempDir.
function userScopedDirs(): string[] {
	return [path.join(getAgentDir(), "extensions"), getPluginsNodeModules()];
}

function isUserScoped(p: string): boolean {
	return userScopedDirs().some(dir => p.startsWith(dir));
}

export function filterUserExtensions<T extends { path: string }>(extensions: T[]): T[] {
	return extensions.filter(ext => !isUserScoped(ext.path));
}

export function filterUserExtensionErrors<T extends { path: string }>(errors: T[]): T[] {
	return errors.filter(err => !isUserScoped(err.path));
}