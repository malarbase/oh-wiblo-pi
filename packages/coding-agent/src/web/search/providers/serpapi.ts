/**
 * SerpAPI Web Search Provider
 *
 * Uses SerpAPI (https://serpapi.com/) for Google AI Mode web search.
 * Returns organic search results with snippets, titles, URLs, and
 * optionally AI-organized answers.
 *
 * Requires SERPAPI_API_KEY environment variable or setting.
 */
import { getEnvApiKey } from "@oh-my-pi/pi-ai";
import type { SearchResponse, SearchSource } from "../../../web/search/types";
import { SearchProviderError } from "../../../web/search/types";
import { dateToAgeSeconds } from "../utils";
import type { SearchParams } from "./base";
import { SearchProvider } from "./base";

const SERPAPI_BASE_URL = "https://serpapi.com/search";
const DEFAULT_NUM_RESULTS = 10;

interface SerpApiOrganicResult {
	title?: string;
	link?: string;
	snippet?: string;
	date?: string;
	thumbnail?: string;
}

interface SerpApiAnswerBox {
	title?: string;
	answer?: string;
	snippet?: string;
}

interface SerpApiSearchMetadata {
	status?: string;
	google_url?: string;
	json_endpoint?: string;
}

interface SerpApiSearchResponse {
	search_metadata?: SerpApiSearchMetadata;
	organic_results?: SerpApiOrganicResult[];
	answer_box?: SerpApiAnswerBox;
	error?: string;
}

function parseDateOrUndefined(dateStr: string | undefined): string | undefined {
	if (!dateStr) return undefined;
	try {
		return new Date(dateStr).toISOString();
	} catch {
		return dateStr;
	}
}

export function buildSerpApiUrl(params: SearchParams, apiKey: string): string {
	const url = new URL(SERPAPI_BASE_URL);
	url.searchParams.set("engine", "google");
	url.searchParams.set("q", params.query);
	url.searchParams.set("api_key", apiKey);
	url.searchParams.set("num", String(params.numSearchResults ?? params.limit ?? DEFAULT_NUM_RESULTS));

	if (params.recency) {
		const tbsMap: Record<string, string> = {
			day: "qdr:d",
			week: "qdr:w",
			month: "qdr:m",
			year: "qdr:y",
		};
		const tbs = tbsMap[params.recency];
		if (tbs) url.searchParams.set("tbs", tbs);
	}

	if (params.googleSearch) {
		if (params.googleSearch.tbs) url.searchParams.set("tbs", String(params.googleSearch.tbs));
	}

	return url.toString();
}

async function searchSerpApi(params: SearchParams, apiKey: string): Promise<SearchResponse> {
	const url = buildSerpApiUrl(params, apiKey);
	const response = await fetch(url, {
		signal: params.signal,
	});

	if (!response.ok) {
		const text = await response.text();
		throw new SearchProviderError("serpapi", `SerpAPI error (${response.status}): ${text}`, response.status);
	}

	const payload = (await response.json()) as SerpApiSearchResponse;

	if (payload.error) {
		throw new SearchProviderError("serpapi", `SerpAPI error: ${payload.error}`);
	}

	// Extract answer_box / AI-organized answer
	const answer = payload.answer_box?.answer ?? payload.answer_box?.snippet ?? undefined;

	// Convert organic results
	const sources: SearchSource[] = [];
	if (payload.organic_results) {
		for (const result of payload.organic_results) {
			if (!result.link) continue;
			const publishedDate = parseDateOrUndefined(result.date);
			sources.push({
				title: result.title ?? result.link,
				url: result.link,
				snippet: result.snippet,
				publishedDate,
				ageSeconds: dateToAgeSeconds(publishedDate),
			});
		}
	}

	return {
		provider: "serpapi",
		answer,
		sources,
		requestId: payload.search_metadata?.json_endpoint,
	};
}

/** Search provider for SerpAPI. */
export class SerpApiProvider extends SearchProvider {
	readonly id = "serpapi" as const;
	readonly label = "SerpAPI";

	isAvailable(): boolean {
		return Boolean(getEnvApiKey("serpapi"));
	}

	search(params: SearchParams): Promise<SearchResponse> {
		const apiKey = getEnvApiKey("serpapi");
		if (!apiKey) {
			return Promise.reject(
				new SearchProviderError(
					"serpapi",
					"SERPAPI_API_KEY is required. Visit https://serpapi.com to get an API key.",
				),
			);
		}
		return searchSerpApi(params, apiKey);
	}
}
