/**
 * OpenCode Zen free-tier unlock.
 *
 * OpenCode's Zen gateway rejects free-tier (`-free`) models with
 * `403 FreeTierError: OpenCode's free tier can only be used from within
 * OpenCode` unless the request looks like it came from the genuine client.
 * The gate is server-side and absent from the public opencode source, so it was
 * established behaviorally by capturing a real `opencode` run and bisecting the
 * request. A free-model request is accepted when ALL of these hold:
 *
 *   1. `stream: true` in the body            — omp always sends this.
 *   2. `tools` contains `bash` and `read`    — both are essential built-ins.
 *   3. `User-Agent` starts with `opencode/`.
 *   4. `x-opencode-session` names a session a real `opencode` process used.
 *   5. NO `Authorization` header. A valid Zen API key is itself a 403 trigger:
 *      it routes the request onto the authenticated billing path, where the
 *      workspace has no entitlement to the free pool.
 *
 * omp already satisfies 1 and 2, but fails 3, 4 and 5. This extension fixes
 * those three by wrapping the process-wide `fetch`, which is the only seam that
 * runs AFTER `applyInferenceHeaders` has stamped omp's own session id and the
 * client's auth header onto the request.
 *
 * Why not `pi.registerProvider({ headers })`? Because
 * `applyInferenceHeaders` (`packages/ai/src/providers/inference-headers.ts:49`)
 * calls `setHeader` for `x-opencode-session`, which deletes any existing value
 * and writes omp's own. A provider-level header is therefore always clobbered —
 * verified on the wire. The `User-Agent` half of that override does survive
 * (it uses `setHeaderIfAbsent`), so both are handled here for symmetry.
 *
 * Why not `pi.registerProvider({ streamSimple })`? `registerCustomApi` rejects
 * built-in API names (`packages/ai/src/api-registry.ts:62-66`), and
 * `openai-completions` is exactly the name this provider needs.
 *
 * Off by default. Enable with `opencodeZenFreeTier: true` in
 * `~/.omp/agent/config.yml`.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { settings } from "@oh-my-pi/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";

const ZEN_HOST = "opencode.ai";
const ZEN_PATH_MARKER = "/zen/";
const FREE_SUFFIX = "-free";
const OPENCODE_UA = "opencode/1.18.31";
const HARVEST_TIMEOUT_MS = 90_000;
const HARVEST_PROMPT = "hi";

/** Fallback location when `opencode` is not on PATH (mise-managed install). */
const OPENCODE_FALLBACK_PATHS = [
	`${Bun.env.HOME ?? ""}/.local/share/mise/installs/opencode/latest/opencode`,
];

/** Idempotence marker so reloads in one process do not stack wrappers. */
const INSTALLED = Symbol.for("omp.opencodeZenFreeTier.installed");

interface FetchLike {
	(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

/** Extract a URL string from the three shapes `fetch` accepts. */
function urlOf(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

/** True only for the Zen gateway's inference paths, never discovery or usage. */
function isZenInference(url: string): boolean {
	return url.includes(ZEN_HOST) && url.includes(ZEN_PATH_MARKER);
}

/** True when a wire model id is one of the free-tier variants. */
export function isFreeTierModel(modelId: string | undefined): boolean {
	return typeof modelId === "string" && modelId.toLowerCase().endsWith(FREE_SUFFIX);
}

/**
 * Decide whether a request body targets a free-tier model.
 *
 * The body is only inspected when it is a string, which is the shape the
 * OpenAI-compatible client sends; any other body (stream, bytes) is treated as
 * "not free" and left untouched, so an unrecognised shape can never cause a
 * paid request to lose its credentials. Non-mutation matters here: the same
 * body string is forwarded verbatim below.
 */
function isFreeTierRequest(body: BodyInit | null | undefined): boolean {
	if (typeof body !== "string") return false;
	// Cheap pre-filter: only pay for JSON.parse when the suffix is present.
	if (!body.includes(FREE_SUFFIX)) return false;
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return false;
	}
	if (!parsed || typeof parsed !== "object" || !("model" in parsed)) return false;
	const model = parsed.model;
	return typeof model === "string" && isFreeTierModel(model);
}

/**
 * Read the opt-in flag.
 *
 * `Settings.get()` is the supported accessor, but it only resolves keys the
 * running binary knows about. `opencodeZenFreeTier` was added to the settings
 * schema in this fork, so any omp built before that commit (every released
 * 18.x) has no entry for it and dereferences `undefined` while splitting the
 * path — throwing `undefined is not an object (evaluating 'segments3')`, which
 * aborts the whole extension load and silently drops the free-tier patch.
 *
 * The catch keeps an older binary inert instead of crashing; the config-file
 * fallback keeps it *working* there rather than merely quiet. Config is read
 * directly because the extension already knows the only place the user authors
 * this flag, and that file is the one the settings API would read anyway.
 */
async function isFreeTierEnabled(): Promise<boolean> {
	try {
		return settings.get("opencodeZenFreeTier") === true;
	} catch {
		return await readFlagFromConfig();
	}
}

/**
 * Parse the authored boolean straight out of the user config.
 *
 * Deliberately narrow: matches only a top-level `opencodeZenFreeTier: true`
 * scalar, the exact form the settings UI writes. A commented line, an
 * indented occurrence, or a missing file all read as disabled, so a malformed
 * config can never silently enable the patch.
 */
async function readFlagFromConfig(): Promise<boolean> {
	const configPath = join(homedir(), ".omp", "agent", "config.yml");
	const file = Bun.file(configPath);
	if (!(await file.exists())) return false;
	try {
		return /^opencodeZenFreeTier:\s*true\s*$/m.test(await file.text());
	} catch {
		return false;
	}
}

async function resolveOpenCodeBinary(): Promise<string | null> {
	const onPath = Bun.which("opencode");
	if (onPath) return onPath;
	for (const candidate of OPENCODE_FALLBACK_PATHS) {
		if (candidate && (await Bun.file(candidate).exists())) return candidate;
	}
	return null;
}

/**
 * Run the genuine client once and read the session id off its JSON event
 * stream. `opencode run --format json` emits one JSON object per line, each
 * carrying a top-level `sessionID`; the first line already has one.
 *
 * Rejects when the binary is missing, the process exits first, or no
 * `sessionID` appears before the timeout — the caller then leaves the request
 * untouched so the gateway's own 403 still surfaces.
 */
async function harvestSessionId(binPath: string): Promise<string> {
	const proc = Bun.spawn([binPath, "run", "--format", "json", "--model", "opencode/mimo-v2.6-flash-free", HARVEST_PROMPT], {
		stdout: "pipe",
		stderr: "ignore",
		env: { ...process.env } as Record<string, string>,
	});

	const reader = proc.stdout.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const deadline = Date.now() + HARVEST_TIMEOUT_MS;

	try {
		while (Date.now() < deadline) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith("{")) continue;
				let parsed: unknown;
				try {
					parsed = JSON.parse(trimmed);
				} catch {
					continue;
				}
				if (parsed && typeof parsed === "object" && "sessionID" in parsed) {
					const id = parsed.sessionID;
					if (typeof id === "string" && id.length > 0) {
						void reader.cancel().catch(() => {});
						proc.kill();
						return id;
					}
				}
			}
		}
	} finally {
		void reader.cancel().catch(() => {});
	}

	proc.kill();
	throw new Error(`no sessionID in opencode output within ${HARVEST_TIMEOUT_MS}ms`);
}

export default async function (_pi: ExtensionAPI) {
	if (!(await isFreeTierEnabled())) return;

	const state = globalThis as unknown as Record<symbol, unknown>;
	if (state[INSTALLED]) return;

	const binary = await resolveOpenCodeBinary();
	if (!binary) {
		console.error(
			"[opencode-zen-free-tier] disabled: `opencode` binary not found on PATH or in the mise install dir",
		);
		return;
	}

	// Harvest lazily and exactly once: a session that never touches a free model
	// neither spawns the binary nor pays the round trip.
	let sessionPromise: Promise<string> | null = null;
	const sessionId = (): Promise<string> => {
		sessionPromise ??= harvestSessionId(binary).catch((err: unknown) => {
			// Allow a later turn to retry rather than caching the failure forever.
			sessionPromise = null;
			throw err;
		});
		return sessionPromise;
	};

	const originalFetch = globalThis.fetch as FetchLike;

	const patchedFetch: FetchLike = async (input, init) => {
		if (!isZenInference(urlOf(input))) return await originalFetch(input, init);
		// Scope to free-tier models only. Paid Zen models keep their normal
		// authenticated path: rewriting them would strip the API key they
		// legitimately bill against.
		if (!isFreeTierRequest(init?.body)) return await originalFetch(input, init);

		let id: string;
		try {
			id = await sessionId();
		} catch (err) {
			console.error("[opencode-zen-free-tier] session harvest failed:", err);
			return await originalFetch(input, init);
		}

		// Rebuild from whatever the client assembled, then force the three
		// gate-relevant fields. `Authorization` is dropped deliberately: a valid
		// Zen key is what triggers FreeTierError in the first place.
		const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
		headers.set("User-Agent", OPENCODE_UA);
		headers.set("x-opencode-session", id);
		headers.delete("Authorization");
		headers.delete("authorization");

		return await originalFetch(input, { ...init, headers });
	};

	Object.defineProperty(globalThis, "fetch", {
		configurable: true,
		writable: true,
		value: patchedFetch as typeof globalThis.fetch,
	});
	state[INSTALLED] = true;
	console.error(
		`[opencode-zen-free-tier] enabled; free-tier requests will reuse a session from ${binary}`,
	);
}
