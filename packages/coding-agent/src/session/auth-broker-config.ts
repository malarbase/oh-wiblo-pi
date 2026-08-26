/**
 * Auth-broker config stub for owp.
 *
 * The fork does not use the auth-broker module. This stub always returns
 * null for broker config (no broker configured) and falls back to the
 * local SQLite credential store.
 */

import { AuthBrokerError, MissingApiKeyError } from "@oh-my-pi/pi-ai/error";
import { getAgentDir } from "@oh-my-pi/pi-utils";
import { AuthStorage } from "./auth-storage";

export type AuthBrokerClientConfig = { url: string; token: string };
export function getAuthBrokerTokenFilePath(): string {
	return "";
}

/**
 * Returns null — no auth-broker configured in the fork.
 */
export function resolveAuthBrokerConfig(): Promise<AuthBrokerClientConfig | null> {
	return Promise.resolve(null);
}

/**
 * Create an AuthStorage instance using the local SQLite store.
 */
export function discoverAuthStorage(agentDir: string = getAgentDir()): Promise<AuthStorage> {
	const dbPath = require("node:path").join(agentDir, "auth.db");
	return AuthStorage.create(dbPath);
}

/**
 * Turn an auth-storage discovery failure raised at CLI startup into a clean,
 * actionable message, or return `null` when the error is unrelated to the
 * broker (so the caller rethrows it unchanged).
 *
 * A configured broker deliberately *replaces* the local credential store —
 * {@link discoverAuthStorage} never silently falls back to local SQLite once
 * `auth.broker.url` is set — so an unreachable broker is fatal. Without this,
 * the underlying `AuthBrokerError` (or missing-token `MissingApiKeyError`)
 * propagates as a raw uncaught exception and the CLI dies with a stack dump
 * instead of recovery guidance (issue #8096).
 */
export async function describeAuthBrokerStartupError(error: unknown): Promise<string | null> {
	if (error instanceof MissingApiKeyError) {
		// resolveAuthBrokerConfig already built an actionable message naming the
		// env var / config key / token-file path to set.
		return error.message;
	}
	if (!(error instanceof AuthBrokerError)) return null;
	let url: string | undefined;
	try {
		url = (await resolveAuthBrokerConfig())?.url;
	} catch {
		// Config resolution itself failed (e.g. token vanished); fall back to a
		// URL-less message rather than masking the original broker failure.
	}
	const target = url ? ` at ${url}` : "";
	return (
		`Auth broker${target} is unreachable (${error.message}). ` +
		"omp is configured to use this broker for credentials and will not fall back to local credentials automatically.\n" +
		"Start the broker with `omp auth-broker serve`, or disable it with " +
		"`omp config reset auth.broker.url` and `omp config reset auth.broker.token` " +
		"(or unset OMP_AUTH_BROKER_URL / OMP_AUTH_BROKER_TOKEN)."
	);
}
