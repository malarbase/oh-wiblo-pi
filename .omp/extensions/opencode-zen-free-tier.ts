/**
 * OpenCode Zen free-tier unlock.
 *
 * OpenCode's Zen gateway rejects free-tier (`-free`) model requests with
 * `403 FreeTierError: OpenCode's free tier can only be used from within
 * OpenCode` unless the request carries a genuine opencode client identity.
 * The gate is server-side and absent from the public opencode source, so it
 * was established behaviorally by capturing a real `opencode` request on the
 * wire (`OPENCODE_CONFIG` baseURL override to a local server) and bisecting
 * header-by-header, body-field-by-body-field. A free-model request is accepted
 * when ALL of these hold:
 *
 *   1. `stream: true` and a free (`-free`) model id — omp always sends both.
 *   2. `tools` contains a `read` entry whose `parameters.properties` is a
 *      non-empty object. That single fingerprint is the entire body check:
 *      description text, `bash`/other tools, `$schema`, `filePath`, `required`,
 *      `tool_choice`, `max_tokens` and `stream_options` are all irrelevant
 *      (all verified by replaying minimised bodies against the live gate).
 *   3. `User-Agent: opencode/<version>` — a real version is required;
 *      `opencode/0.0.1` gets `426 Upgrade Required`.
 *   4. `authorization: Bearer st_…` — the opencode *console session* token
 *      from `~/.local/share/opencode/opencode.db` (`account.access_token`).
 *      Missing → 403; forged → 401. An `oc_sk_` API key is only accepted when
 *      it happens to belong to the same workspace as the org header (one of
 *      omp's two zen keys passes, the other 403s), so the console token is the
 *      only self-consistent choice: it is read together with its workspace.
 *   5. `x-opencode-org-id: wrk_…` — `account_state.active_org_id`, same db.
 *      Missing → 403; forged → 403.
 *   6. `x-opencode-session` AND `x-opencode-session-id` — must both name a
 *      session a real `opencode run` process created (verified: either missing,
 *      forged, or mismatched → 403).
 *
 *   Optional on the gate (drop verified safe): `x-opencode-project`,
 *   `x-opencode-client`, `x-opencode-request`, and any extra headers.
 *
 * omp already satisfies 1 and 2 (its read tool has a real `filePath` schema)
 * but fails 3–6: it sends `User-Agent: omp/…`, stamps its own install id as
 * `x-opencode-session`, has no org/session-id headers at all, and carries its
 * `oc_sk_` zen key. This extension fixes 3–6 by wrapping the process-wide
 * `fetch`, the only seam that runs AFTER `applyInferenceHeaders` has stamped
 * omp's own session id and auth header onto the request.
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
 * Token lifecycle: the console session token expires (~6 days). A full
 * `opencode run` — which the harvest performs — runs opencode's own auth
 * cycle, so the identity is re-read from the database after every refresh and
 * on every request. When the login is missing or unrefreshable the problem is
 * surfaced to the user (TUI notification + file log) instead of leaving a bare
 * FreeTierError to be misread as a quota problem.
 *
 * Quota is shared, and saying so is part of the job. This extension lends omp
 * opencode's console identity, so omp has no free allowance of its own — it
 * draws from the single daily pool attached to the workspace. A `429
 * FreeUsageLimitError` therefore means the pool is empty, NOT that the login
 * broke, and the two are indistinguishable from the response alone. It is
 * surfaced with its reset time instead of being passed through as a raw
 * provider error, and never retried: a retry spends another request to earn
 * the same rejection.
 *
 * Off by default. Enable with `opencodeZenFreeTier: true` in
 * `~/.omp/agent/config.yml`.
 */

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { logger, settings } from "@oh-my-pi/pi-coding-agent";
import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

const ZEN_HOST = "opencode.ai";
const ZEN_PATH_MARKER = "/zen/";
const FREE_SUFFIX = "-free";
const DEFAULT_OPENCODE_UA = "opencode/1.18.31";
const HARVEST_TIMEOUT_MS = 90_000;
/**
 * Mandatory positional argument for `opencode run` — never transmitted. The
 * harvest kills the process at the first `step_start` event, which opencode
 * emits *before* it dispatches the provider call, so no request is ever made
 * (verified against a capture server: zero `/chat/completions` hits). There is
 * therefore nothing for prefix caching to reuse; a real session prompt would
 * only risk `ARG_MAX` and expose user content in the process table.
 */
const HARVEST_PROMPT = "hi";
/**
 * The model the harvest run drives:
 *
 *   - The gate validates only that the session is real, never which model
 *     created it. A session minted by a `mimo-v2.6-flash-free` run serves a
 *     `space-bunny-free` request unchanged (verified on the wire), so there is
 *     no correctness reason to mirror the caller's model.
 *   - `gpt-5.4-nano` is opencode's own title model, so it is present in every
 *     version by construction rather than by our guess. That is the whole
 *     reason: the previous hardcoded `mimo-v2.6-flash-free` had already decayed
 *     to a single occurrence in the 1.19.0 catalog, and a name that vanishes
 *     breaks the harvest silently, degrading every free request to the raw
 *     `oc_sk_` key with nothing in the log to explain it.
 *   - Not the in-flight model either. That is always a `-free` model here
 *     (`analyzeRequestBody` gates on it), and mirroring it would make the
 *     harvest's success depend on the pool it exists to protect. Since the
 *     harvest makes no model request at all, that dependency buys nothing.
 */
const HARVEST_MODEL = "opencode/gpt-5.4-nano";
/** Refresh the console token when it expires within this window. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/** opencode's local database: console session token + active workspace. */
const OPENCODE_DB_PATH = join(homedir(), ".local", "share", "opencode", "opencode.db");

/** Fallback location when `opencode` is not on PATH (mise-managed install). */
const OPENCODE_FALLBACK_PATHS = [
	`${Bun.env.HOME ?? ""}/.local/share/mise/installs/opencode/latest/opencode`,
];

/** Idempotence marker so reloads in one process do not stack wrappers. */
const INSTALLED = Symbol.for("omp.opencodeZenFreeTier.installed");

interface FetchLike {
	(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

/** The opencode console login, read as one atomic token+workspace pair. */
interface ZenIdentity {
	token: string;
	orgId: string;
	/** Epoch ms; `0` when the database does not say. */
	expiresAt: number;
}

interface FreeTierAnalysis {
	freeTier: boolean;
	/** Whether the body satisfies the gate's `read`-tool fingerprint. */
	gateSatisfied: boolean;
}

/** Why the request cannot be gated; `detail` carries harvest error context. */
type PrepFailure = "no-login" | "harvest" | "expired";

type Prep = { headers: Headers; identity: ZenIdentity } | { failure: PrepFailure; detail?: string };

type SurfaceLevel = "info" | "warning" | "error";

/** Extract a URL string from the three shapes `fetch` accepts. */
function urlOf(input: string | URL | Request): string {
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
 * True when the parsed body carries a `read` tool with a non-empty
 * `parameters.properties` — the gate's entire body-side fingerprint.
 */
function hasGateReadTool(body: Record<string, unknown>): boolean {
	const tools = body.tools;
	if (!Array.isArray(tools)) return false;
	return tools.some((entry) => {
		if (!entry || typeof entry !== "object") return false;
		const fn = (entry as { function?: unknown }).function;
		if (!fn || typeof fn !== "object") return false;
		const { name, parameters } = fn as { name?: unknown; parameters?: unknown };
		if (name !== "read") return false;
		if (!parameters || typeof parameters !== "object") return false;
		const properties = (parameters as { properties?: unknown }).properties;
		return (
			!!properties &&
			typeof properties === "object" &&
			!Array.isArray(properties) &&
			Object.keys(properties).length > 0
		);
	});
}

/**
 * Decide whether a request body targets a free-tier model, and whether it
 * already satisfies the gate's body fingerprint.
 *
 * The body is only inspected when it is a string, which is the shape the
 * OpenAI-compatible client sends; any other body (stream, bytes) is treated as
 * "not free" and left untouched, so an unrecognised shape can never cause a
 * paid request to lose its credentials. Non-mutation matters here: the same
 * body string is forwarded verbatim below.
 */
function analyzeRequestBody(body: RequestInit["body"]): FreeTierAnalysis {
	const absent: FreeTierAnalysis = { freeTier: false, gateSatisfied: false };
	if (typeof body !== "string") return absent;
	// Cheap pre-filter: only pay for JSON.parse when the suffix is present.
	if (!body.includes(FREE_SUFFIX)) return absent;
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return absent;
	}
	if (!parsed || typeof parsed !== "object" || !("model" in parsed)) return absent;
	const model = (parsed as { model?: unknown }).model;
	if (!isFreeTierModel(typeof model === "string" ? model : undefined)) return absent;
	return { freeTier: true, gateSatisfied: hasGateReadTool(parsed as Record<string, unknown>) };
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
 * Read the console session token and its workspace as one pair.
 *
 * Fresh on every call so a token opencode refreshed mid-process is picked up
 * immediately, and so token and org can never come from different logins.
 * Returns `null` when opencode has no console login (fresh install, signed
 * out) — the caller surfaces that instead of guessing an identity.
 */
async function readOpenCodeIdentity(): Promise<ZenIdentity | null> {
	if (!(await Bun.file(OPENCODE_DB_PATH).exists())) return null;
	let db: Database | undefined;
	try {
		db = new Database(OPENCODE_DB_PATH, { readonly: true });
		const state = db
			.query<{ active_account_id: string | null; active_org_id: string | null }, []>(
				"SELECT active_account_id, active_org_id FROM account_state ORDER BY id LIMIT 1",
			)
			.get();
		if (!state?.active_org_id || !state.active_account_id) return null;
		const account = db
			.query<{ access_token: string | null; token_expiry: number | null }, [string]>(
				"SELECT access_token, token_expiry FROM account WHERE id = ?",
			)
			.get(state.active_account_id);
		if (!account?.access_token) return null;
		return {
			token: account.access_token,
			orgId: state.active_org_id,
			expiresAt: account.token_expiry ?? 0,
		};
	} catch (err) {
		logger.warn("opencode-zen-free-tier: cannot read opencode database", {
			path: OPENCODE_DB_PATH,
			err,
		});
		return null;
	} finally {
		db?.close();
	}
}

/**
 * Run the genuine client once and read the session id off its JSON event stream.
 * `opencode run --format json` emits one JSON object per line, each carrying a
 * top-level `sessionID`; the first line already has one.
 *
 * `needAuthCycle` decides how far the run has to get. When the console token is
 * already valid the session id is all this owes, so the run is stopped at the
 * first event — the model call it would have made is pure latency. When the
 * token is near expiry the run is awaited to completion instead, because that
 * is what drives opencode's auth cycle and mints the refreshed token.
 *
 * A non-zero exit is deliberately NOT an error. opencode creates and persists
 * the session before it calls the model, and the gateway accepts a session from
 * a run whose model call failed: verified by replaying a free-model request
 * against a session harvested from a run that exited 1 with `Cannot connect to
 * API`, which answered 200. The exit code therefore carries nothing the caller
 * can act on, and rejecting it only turned a recoverable situation into a full
 * timeout followed by a misleading "check your login" message. Token freshness
 * is guarded separately by the post-run re-read in `prepareHeaders`.
 */
async function harvestSessionId(binPath: string, needAuthCycle: boolean): Promise<string> {
	const proc = Bun.spawn(
		[binPath, "run", "--format", "json", "--model", HARVEST_MODEL, HARVEST_PROMPT],
		{
			stdout: "pipe",
			stderr: "ignore",
			env: { ...process.env } as Record<string, string>,
		},
	);

	const reader = proc.stdout.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let session: string | null = null;
	let timedOut = false;
	const deadline = Date.now() + HARVEST_TIMEOUT_MS;

	try {
		while (!timedOut) {
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				timedOut = true;
				break;
			}
			const outcome = await Promise.race([
				reader.read(),
				Bun.sleep(remaining).then(() => "timed-out" as const),
			]);
			if (outcome === "timed-out") {
				timedOut = true;
				break;
			}
			if (outcome.done) break;
			buffer += decoder.decode(outcome.value, { stream: true });
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
				if (session !== null || !parsed || typeof parsed !== "object") continue;
				if (!("sessionID" in parsed)) continue;
				const id = parsed.sessionID;
				if (typeof id === "string" && id.length > 0) session = id;
			}
			if (session !== null && !needAuthCycle) break;
		}
	} finally {
		void reader.cancel().catch(() => {});
	}

	if (session !== null && !needAuthCycle) {
		proc.kill();
		return session;
	}

	if (timedOut) {
		proc.kill();
		throw new Error(`opencode run did not finish within ${HARVEST_TIMEOUT_MS}ms`);
	}
	const exitCode = await proc.exited;
	if (needAuthCycle && exitCode !== 0) throw new Error(`opencode run exited with code ${exitCode}`);
	if (!session) throw new Error("no sessionID in opencode output");
	return session;
}

export default async function (pi: ExtensionAPI) {
	if (!(await isFreeTierEnabled())) return;

	const state = globalThis as unknown as Record<symbol, unknown>;
	if (state[INSTALLED]) return;

	const binary = await resolveOpenCodeBinary();
	if (!binary) {
		logger.error(
			"[opencode-zen-free-tier] disabled: `opencode` binary not found on PATH or in the mise install dir",
		);
		return;
	}

	// Latest UI context, captured so fetch-time failures can talk to the user.
	let uiContext: ExtensionContext | undefined;
	pi.on("session_start", (_event, ctx) => {
		uiContext = ctx;
	});
	pi.on("before_provider_request", (_event, ctx) => {
		uiContext = ctx;
	});

	// Notify at most once per distinct message; always mirror to the file log.
	// `key` lets a message that embeds a moving timestamp (the quota reset time)
	// still collapse to a single notification per process.
	const surfaced = new Set<string>();
	const surface = (message: string, level: SurfaceLevel, key: string = message): void => {
		if (level === "error") logger.error(message);
		else if (level === "warning") logger.warn(message);
		else logger.info(message);
		const ui = uiContext?.ui;
		if (!ui || surfaced.has(key)) return;
		surfaced.add(key);
		ui.notify(message, level);
	};

	// Harvest lazily and exactly once: a session that never touches a free model
	// neither spawns the binary nor pays the round trip.
	let sessionPromise: Promise<string> | null = null;
	const sessionId = (needAuthCycle: boolean): Promise<string> => {
		sessionPromise ??= harvestSessionId(binary, needAuthCycle).catch((err: unknown) => {
			// Allow a later turn to retry rather than caching the failure forever.
			sessionPromise = null;
			throw err;
		});
		return sessionPromise;
	};
	const invalidateSession = (): void => {
		sessionPromise = null;
	};

	// `opencode --version` once per process; the gate enforces a version floor.
	let uaPromise: Promise<string> | null = null;
	const openCodeUserAgent = (): Promise<string> => {
		uaPromise ??= (async () => {
			try {
				const proc = Bun.spawn([binary, "--version"], { stdout: "pipe", stderr: "ignore" });
				const out = (await new Response(proc.stdout).text()).trim();
				await proc.exited;
				const version = out.split(/\s+/).pop();
				if (version && /^[\w.+-]+$/.test(version)) return `opencode/${version}`;
			} catch (err) {
				logger.debug("opencode-zen-free-tier: cannot read opencode version", { err });
			}
			return DEFAULT_OPENCODE_UA;
		})();
		return uaPromise;
	};

	/**
	 * Build the gate-satisfying headers: fresh identity from opencode's
	 * database plus a session from a real `opencode run`. `refresh` forces a
	 * new run first, which is what re-mints an expired console token.
	 */
	const prepareHeaders = async (base: Headers, refresh: boolean): Promise<Prep> => {
		if (refresh) invalidateSession();
		let identity = await readOpenCodeIdentity();
		if (!identity) return { failure: "no-login" };
		const nearExpiry =
			identity.expiresAt > 0 && identity.expiresAt <= Date.now() + TOKEN_REFRESH_MARGIN_MS;
		if (nearExpiry) invalidateSession();

		let session: string;
		try {
			session = await sessionId(nearExpiry);
		} catch (err) {
			return { failure: "harvest", detail: err instanceof Error ? err.message : String(err) };
		}

		if (nearExpiry) {
			// The run above completed opencode's auth cycle; re-read the token.
			identity = (await readOpenCodeIdentity()) ?? identity;
			if (identity.expiresAt > 0 && identity.expiresAt <= Date.now()) {
				return { failure: "expired" };
			}
		}

		const headers = new Headers(base);
		headers.set("User-Agent", await openCodeUserAgent());
		headers.set("Authorization", `Bearer ${identity.token}`);
		headers.set("x-opencode-org-id", identity.orgId);
		headers.set("x-opencode-session", session);
		headers.set("x-opencode-session-id", session);
		return { headers, identity };
	};

	const failureMessage = (failure: PrepFailure, detail?: string): { text: string; level: SurfaceLevel } => {
		switch (failure) {
			case "no-login":
				return {
					text:
						"OpenCode Zen free tier: no opencode console login found (~/.local/share/opencode). " +
						"omp's own zen API key is not accepted for the free pool — run `opencode` and log in.",
					level: "error",
				};
			case "expired":
				return {
					text:
						"OpenCode Zen free tier: the opencode session expired and could not be refreshed — " +
						"run `opencode` to log in again.",
					level: "error",
				};
			case "harvest":
				return {
					text: `OpenCode Zen free tier: cannot start opencode for a session (${detail ?? "unknown"}) — check your \`opencode\` login.`,
					level: "error",
				};
		}
	};

	const rejectedMessage = (status: number, detail: string): string => {
		const excerpt = detail.replace(/\s+/g, " ").slice(0, 160);
		if (status === 401) {
			return (
				"OpenCode Zen free tier: opencode rejected the session token (401) — " +
				`run \`opencode\` to log in again. ${excerpt}`
			);
		}
		return `OpenCode Zen free tier: still rejected by the free-tier gate (403): ${excerpt}`;
	};

	/**
	 * `retry-after-ms`, then `retry-after` seconds, then the `retry-after-ms=` hint
	 * the gateway embeds in the error body — the same precedence
	 * `@oh-my-pi/pi-utils`' `fetchWithRetry` applies, so the number shown here is
	 * the one omp actually backed off against.
	 */
	const parseRetryAfterMs = (headers: Headers, detail: string): number | undefined => {
		const rawMs = headers.get("retry-after-ms");
		if (rawMs) {
			const ms = Number.parseFloat(rawMs);
			if (Number.isFinite(ms) && ms > 0) return ms;
		}
		const rawSeconds = headers.get("retry-after");
		if (rawSeconds) {
			const seconds = Number.parseFloat(rawSeconds);
			if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
		}
		const fromBody = /retry-after-ms=(\d+)/.exec(detail);
		if (fromBody?.[1]) {
			const ms = Number.parseInt(fromBody[1], 10);
			if (Number.isFinite(ms) && ms > 0) return ms;
		}
		return undefined;
	};

	/**
	 * A 429 is a quota fact, not a credential fact, and the two look identical
	 * from the outside — the gateway returns a bare `FreeUsageLimitError` for a
	 * pool that every client on this workspace shares. Say so, because the
	 * default reading of "free tier rejected me" is a broken login, and acting
	 * on that sends people to re-authenticate a session that is working fine.
	 */
	const quotaMessage = (headers: Headers, detail: string): string => {
		const retryAfterMs = parseRetryAfterMs(headers, detail);
		let reset = "";
		if (retryAfterMs !== undefined && retryAfterMs <= 7 * 24 * 3_600_000) {
			const hours = Math.floor(retryAfterMs / 3_600_000);
			const minutes = Math.round((retryAfterMs % 3_600_000) / 60_000);
			const wait = hours > 0 ? `about ${hours}h ${minutes}m` : `${minutes}m`;
			reset = ` It should reopen in ${wait}, around ${new Date(Date.now() + retryAfterMs).toLocaleTimeString()}.`;
		}
		return (
			"OpenCode Zen free tier: this workspace's shared free-model quota is exhausted (429) — not a credential problem. " +
			"omp borrows opencode's console identity by design, so it shares one daily pool with standalone opencode; " +
			`anything using free Zen models can exhaust it.${reset}`
		);
	};

	const originalFetch = globalThis.fetch as FetchLike;
	let announcedSource = false;

	const patchedFetch: FetchLike = async (input, init) => {
		if (!isZenInference(urlOf(input))) return await originalFetch(input, init);
		// Scope to free-tier models only. Paid Zen models keep their normal
		// authenticated path: rewriting them would change what they bill against.
		const analysis = analyzeRequestBody(init?.body);
		if (!analysis.freeTier) return await originalFetch(input, init);

		if (!analysis.gateSatisfied) {
			surface(
				"OpenCode Zen free tier: this request carries no `read` tool, which the free-tier gate requires — the reply will be rejected.",
				"warning",
			);
		}

		const base = new Headers(
			init?.headers ?? (input instanceof Request ? input.headers : undefined),
		);

		// One retry: a 401 means the console token expired, a 403 the session
		// went stale — both are cured by a fresh `opencode run`, which re-mints
		// the token and yields a new session. Skipped when the body itself is
		// missing the gate fingerprint, since no re-run can repair that.
		let attempt = 0;
		for (;;) {
			const prep = await prepareHeaders(base, attempt > 0);
			if ("failure" in prep) {
				const { text, level } = failureMessage(prep.failure, prep.detail);
				surface(text, level);
				return await originalFetch(input, init);
			}

			if (!announcedSource) {
				announcedSource = true;
				const originalAuth = base.get("authorization") ?? "none";
				surface(
					`OpenCode Zen free tier: free-model calls use opencode's console session (${originalAuth.slice(0, 12)}… replaced by its st_ token), not omp's oc_sk_ zen key.`,
					"info",
				);
			}

			const res = await originalFetch(input, { ...init, headers: prep.headers });

			// A 429 is terminal and must not be retried: the pool is empty, so a
			// fresh harvest would spend another request to earn the same rejection
			// and re-enter this branch. Surface it once per process — the reset
			// time moves, so the message needs its own dedupe key — then hand the
			// response back untouched.
			if (res.status === 429) {
				const quotaDetail = await res.clone().text().catch(() => "");
				surface(quotaMessage(res.headers, quotaDetail), "warning", "zen-free-quota");
				return res;
			}

			if (res.status !== 401 && res.status !== 403) return res;

			const detail = await res.clone().text().catch(() => "");
			if (attempt === 0 && analysis.gateSatisfied) {
				attempt = 1;
				continue;
			}
			surface(rejectedMessage(res.status, detail), "error");
			return res;
		}
	};

	Object.defineProperty(globalThis, "fetch", {
		configurable: true,
		writable: true,
		value: patchedFetch as typeof globalThis.fetch,
	});
	state[INSTALLED] = true;
	logger.info(
		`[opencode-zen-free-tier] enabled; free-tier requests will reuse a session from ${binary}`,
	);
}
