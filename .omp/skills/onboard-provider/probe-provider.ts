#!/usr/bin/env bun
/**
 * Standalone provider onboarding probe.
 *
 * Probes a base URL + API key, auto-detects the API shape, and writes
 * the provider config to ~/.omp/agent/models.yml.
 *
 * Usage:
 *   bun run probe-provider.ts <name> <baseUrl> <apiKey>
 *
 * Exit 0 on success (JSON result on stdout).
 * Exit 1 on error (message on stderr).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import { YAML } from "bun";

// ── Types ──────────────────────────────────────────────────────────────

type ProbeApi =
	| "openai-completions"
	| "openai-responses"
	| "anthropic-messages"
	| "bedrock-converse-stream"
	| "google-generative-ai"
	| "google-vertex"
	| "google-gemini-cli"
	| "openai-codex-responses"
	| "azure-openai-responses";

interface ProbeResult {
	baseUrl: string;
	apiKey: string;
	api: ProbeApi;
	auth: "apiKey" | "none";
	authHeader: boolean;
	discovery: { type: string; timeoutMs?: number };
	models?: Array<{ id: string; name?: string }>;
	warnings: string[];
}

// ── Probe ──────────────────────────────────────────────────────────────

const PROBE_TIMEOUT_MS = 10_000;

async function probeEndpoint(baseUrl: string, apiKey: string): Promise<ProbeResult> {
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

	try {
		const start = Date.now();
		const res = await fetch(`${normalized}/models`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			signal: controller.signal,
		});
		const rtt = Date.now() - start;

		if (res.status === 401 || res.status === 403) {
			result.auth = "apiKey";
			warnings.push(
				`Auth rejected (HTTP ${res.status}). The endpoint may require a different auth method.`,
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

		// 200 but no recognizable model list
		result.auth = "none";
		warnings.push("Endpoint responded 200 but no recognizable model list was found.");
		return result;
	} catch (err) {
		if (err instanceof DOMException && err.name === "AbortError") {
			warnings.push(`Probe timed out after ${PROBE_TIMEOUT_MS}ms hitting ${normalized}/models`);
		} else {
			warnings.push(`Probe failed: ${err instanceof Error ? err.message : String(err)}`);
		}
		return result;
	} finally {
		clearTimeout(timer);
	}
}

// ── Config writer ──────────────────────────────────────────────────────

const MODELS_CONFIG_PATH = path.join(homedir(), ".omp", "agent", "models.yml");

interface ModelsConfig {
	providers?: Record<string, Record<string, unknown>>;
	[key: string]: unknown;
}

async function readConfig(): Promise<ModelsConfig> {
	try {
		const text = await Bun.file(MODELS_CONFIG_PATH).text();
		return (YAML.parse(text) as ModelsConfig) ?? {};
	} catch {
		return {};
	}
}

async function writeConfig(config: ModelsConfig): Promise<void> {
	const yaml = YAML.stringify(config, null, 2);
	await Bun.write(MODELS_CONFIG_PATH, yaml);
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
	const args = process.argv.slice(2);
	if (args.length < 3) {
		console.error("Usage: bun run probe-provider.ts <name> <baseUrl> <apiKey>");
		process.exit(1);
	}

	const [name, baseUrl, apiKey] = args;

	// Probe the endpoint
	const probe = await probeEndpoint(baseUrl, apiKey);

	// Build provider config from probe result
	const config: Record<string, unknown> = {
		baseUrl: probe.baseUrl,
		apiKey: probe.apiKey,
		api: probe.api,
		auth: probe.auth,
		authHeader: probe.authHeader,
		discovery: probe.discovery,
	};

	// Write to models.yml
	const existing = await readConfig();
	existing.providers = existing.providers ?? {};
	existing.providers[name] = config;
	await writeConfig(existing);

	// Output result
	const result = {
		providerName: name,
		config,
		modelsFound: probe.models?.length ?? 0,
		warnings: probe.warnings,
	};
	console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
