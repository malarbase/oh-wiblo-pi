import { describe, expect, it } from "bun:test";
import type { SearchParams } from "../../src/web/search/providers/base";
import { buildSerpApiUrl, SerpApiProvider } from "../../src/web/search/providers/serpapi";

function makeParams(overrides: Partial<SearchParams> = {}): SearchParams {
	return {
		query: "test query",
		systemPrompt: "You are a helpful assistant.",
		...overrides,
	} as any;
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
});
