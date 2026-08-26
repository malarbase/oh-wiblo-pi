/**
 * Endpoint introspection for non-interactive provider onboarding.
 * Probes a base URL + API key and returns the detected API shape,
 * auth mode, discovery metadata, and available model list.
 */

import type { ProviderDiscovery } from "./models-config-schema";

export type ProbeApi =
	| "openai-completions"
	| "openai-responses"
	| "anthropic-messages"
	| "bedrock-converse-stream"
	| "google-generative-ai"
	| "google-vertex"
	| "google-gemini-cli"
	| "openai-codex-responses"
	| "azure-openai-responses";

export type ProbeAuth = "apiKey" | "none";

export interface ProbeResult {
	baseUrl: string;
	apiKey: string;
	api: ProbeApi;
	auth: ProbeAuth;
	authHeader: boolean;
	discovery: ProviderDiscovery;
	models?: Array<{ id: string; name?: string }>;
	warnings: string[];
}

const PROBE_TIMEOUT_MS = 10_000;

/**
 * Hit the `/models` endpoint and infer API shape from the response.
 *
 * - OpenAI-shaped `data[]` → openai-completions / openai-compatible
 * - Ollama-shaped `models[]` → ollama discovery
 * - 401/403 → auth required but key invalid
 * - Network error → safe defaults + warning
 */
export async function probeEndpoint(
	baseUrl: string,
	apiKey: string,
	opts?: { signal?: AbortSignal },
): Promise<ProbeResult> {
	const warnings: string[] = [];
	const normalized = baseUrl.replace(/\/+$/, "");

	const result: ProbeResult = {
		baseUrl: normalized,
		apiKey,
		api: "openai-completions",
		auth: "apiKey",
		authHeader: true,
		discovery: { type: "openai-compatible" },
		warnings,
	};

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
	if (opts?.signal) {
		opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
	}

	try {
		const t0 = Date.now();
		const res = await fetch(`${normalized}/models`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
			signal: controller.signal,
		});
		const rtt = Date.now() - t0;

		if (res.status === 401 || res.status === 403) {
			result.auth = "apiKey";
			warnings.push(
				`Authentication failed (HTTP ${res.status}). The key may be invalid or the endpoint requires a different auth method.`,
			);
			result.discovery.timeoutMs = Math.max(5000, Math.ceil(rtt * 3));
			return result;
		}

		if (!res.ok) {
			warnings.push(`Unexpected status ${res.status} from ${normalized}/models`);
			result.discovery.timeoutMs = Math.max(5000, Math.ceil(rtt * 3));
			return result;
		}

		const body = (await res.json()) as Record<string, unknown>;
		result.discovery.timeoutMs = Math.max(5000, Math.ceil(rtt * 3));

		// OpenAI shape: { data: [{ id, name, ... }] }
		const data = body.data;
		if (
			Array.isArray(data) &&
			data.length > 0 &&
			typeof data[0] === "object" &&
			data[0] !== null &&
			"id" in data[0]
		) {
			result.api = "openai-completions";
			result.discovery.type = "openai-compatible";
			result.auth = "none";
			result.models = data.map((m: Record<string, unknown>) => ({
				id: String(m.id),
				name: typeof m.name === "string" ? m.name : undefined,
			}));
			return result;
		}

		// Ollama shape: { models: [{ name, model, ... }] }
		const models = body.models;
		if (Array.isArray(models) && models.length > 0 && typeof models[0] === "object" && models[0] !== null) {
			result.api = "openai-completions";
			result.discovery.type = "ollama";
			result.auth = "none";
			result.models = models.map((m: Record<string, unknown>) => ({
				id: String(m.name ?? m.model ?? ""),
				name: typeof m.name === "string" ? m.name : undefined,
			}));
			return result;
		}

		// 200 but no recognizable model list — auth might not be needed
		result.auth = "none";
		warnings.push(`Endpoint responded with 200 but no recognizable model list was found.`);
		return result;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (err instanceof DOMException && err.name === "AbortError") {
			warnings.push(`Probe timed out after ${PROBE_TIMEOUT_MS}ms for ${normalized}/models`);
		} else {
			warnings.push(`Probe failed: ${msg}`);
		}
		return result;
	} finally {
		clearTimeout(timer);
	}
}
