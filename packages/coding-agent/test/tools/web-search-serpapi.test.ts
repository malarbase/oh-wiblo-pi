import { describe, expect, it } from "bun:test";
import type { AuthStorage } from "@oh-my-pi/pi-ai";
import type { SearchParams } from "../../src/web/search/providers/base";
import { buildSerpApiUrl, SerpApiProvider } from "../../src/web/search/providers/serpapi";

function makeParams(overrides: Partial<SearchParams> = {}): SearchParams {
	return {
		query: "test query",
		systemPrompt: "You are a helpful assistant.",
		authStorage: makeAuthStorage(undefined),
		...overrides,
	};
}

function makeAuthStorage(apiKey: string | undefined): AuthStorage {
	return {
		hasAuth(provider: string) {
			return provider === "serpapi" && Boolean(apiKey);
		},
		resolver(provider: string) {
			expect(provider).toBe("serpapi");
			return async () => apiKey;
		},
	} as unknown as AuthStorage;
}

describe("buildSerpApiUrl", () => {
	it("includes engine=google, query, and api_key", () => {
		const url = new URL(buildSerpApiUrl(makeParams({ query: "hello world" }), "test-key"));
		expect(url.searchParams.get("engine")).toBe("google");
		expect(url.searchParams.get("q")).toBe("hello world");
		expect(url.searchParams.get("api_key")).toBe("test-key");
	});

	it("defaults num to 10 when limit and numSearchResults are absent", () => {
		const url = new URL(buildSerpApiUrl(makeParams(), "test-key"));
		expect(url.searchParams.get("num")).toBe("10");
	});

	it("uses limit when numSearchResults is absent", () => {
		const url = new URL(buildSerpApiUrl(makeParams({ limit: 5 }), "test-key"));
		expect(url.searchParams.get("num")).toBe("5");
	});

	it("prefers numSearchResults over limit", () => {
		const url = new URL(buildSerpApiUrl(makeParams({ limit: 5, numSearchResults: 20 }), "test-key"));
		expect(url.searchParams.get("num")).toBe("20");
	});

	it("sets tbs for recency filters", () => {
		expect(new URL(buildSerpApiUrl(makeParams({ recency: "day" }), "k")).searchParams.get("tbs")).toBe("qdr:d");
		expect(new URL(buildSerpApiUrl(makeParams({ recency: "week" }), "k")).searchParams.get("tbs")).toBe("qdr:w");
		expect(new URL(buildSerpApiUrl(makeParams({ recency: "month" }), "k")).searchParams.get("tbs")).toBe("qdr:m");
		expect(new URL(buildSerpApiUrl(makeParams({ recency: "year" }), "k")).searchParams.get("tbs")).toBe("qdr:y");
	});

	it("ignores unknown recency values", () => {
		const url = new URL(buildSerpApiUrl(makeParams({ recency: "decade" as "year" }), "k"));
		expect(url.searchParams.has("tbs")).toBe(false);
	});

	it("sets tbs from googleSearch.tbs", () => {
		const url = new URL(buildSerpApiUrl(makeParams({ googleSearch: { tbs: "qdr:h" } }), "k"));
		expect(url.searchParams.get("tbs")).toBe("qdr:h");
	});

	it("lets googleSearch.tbs override recency tbs", () => {
		const url = new URL(buildSerpApiUrl(makeParams({ recency: "day", googleSearch: { tbs: "qdr:h" } }), "k"));
		expect(url.searchParams.get("tbs")).toBe("qdr:h");
	});
});

describe("SerpApiProvider", () => {
	it("has correct id and label", () => {
		const provider = new SerpApiProvider();
		expect(provider.id).toBe("serpapi");
		expect(provider.label).toBe("SerpAPI");
	});

	it("is unavailable without a credential and available with SERPAPI_API_KEY", () => {
		const originalApiKey = process.env.SERPAPI_API_KEY;
		delete process.env.SERPAPI_API_KEY;
		try {
			const provider = new SerpApiProvider();
			const keyless = makeAuthStorage(undefined);

			expect(provider.isAvailable(keyless)).toBe(false);
			expect(provider.isExplicitlyAvailable(keyless)).toBe(false);

			process.env.SERPAPI_API_KEY = "test-serpapi-key";
			expect(provider.isAvailable(keyless)).toBe(true);
			expect(provider.isExplicitlyAvailable(keyless)).toBe(true);
		} finally {
			if (originalApiKey === undefined) delete process.env.SERPAPI_API_KEY;
			else process.env.SERPAPI_API_KEY = originalApiKey;
		}
	});

	it("is available from a stored authStorage credential without the env var", () => {
		const originalApiKey = process.env.SERPAPI_API_KEY;
		delete process.env.SERPAPI_API_KEY;
		try {
			const provider = new SerpApiProvider();
			expect(provider.isAvailable(makeAuthStorage("stored-key"))).toBe(true);
		} finally {
			if (originalApiKey === undefined) delete process.env.SERPAPI_API_KEY;
			else process.env.SERPAPI_API_KEY = originalApiKey;
		}
	});

	it("rejects with a clear error when no credential resolves", async () => {
		const originalApiKey = process.env.SERPAPI_API_KEY;
		delete process.env.SERPAPI_API_KEY;
		try {
			const provider = new SerpApiProvider();
			await expect(provider.search(makeParams({ authStorage: makeAuthStorage(undefined) }))).rejects.toThrow(
				'SerpAPI credentials not found. Set SERPAPI_API_KEY or configure an API key for provider "serpapi".',
			);
		} finally {
			if (originalApiKey === undefined) delete process.env.SERPAPI_API_KEY;
			else process.env.SERPAPI_API_KEY = originalApiKey;
		}
	});
});
