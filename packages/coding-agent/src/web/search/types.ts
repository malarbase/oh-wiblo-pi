/**
 * Web Search Types
 *
 * Unified types for web search responses across supported providers.
 */

export const SEARCH_PROVIDER_OPTIONS = [
	{
		value: "auto",
		label: "Auto",
		description: "Automatically uses the first configured web-search provider",
	},
	{
		value: "perplexity",
		label: "Perplexity",
		description: "Uses auth when configured; explicit selection falls back to anonymous search",
	},
	{
		value: "gemini",
		label: "Gemini",
		description: "Google Search grounding via Gemini (uses google-gemini-cli or google-antigravity OAuth)",
	},
	{
		value: "anthropic",
		label: "Anthropic",
		description: "Claude's native web_search tool (uses Anthropic OAuth or ANTHROPIC_API_KEY)",
	},
	{
		value: "codex",
		label: "OpenAI",
		description: "OpenAI's native web_search (uses ChatGPT OAuth via /login openai-codex)",
	},
	{
		value: "xai",
		label: "xAI",
		description:
			"Grok web search via xAI Responses API (uses SuperGrok/X Premium+ OAuth via /login xai-oauth, or XAI_API_KEY)",
	},
	{ value: "zai", label: "Z.AI", description: "Calls Z.AI webSearchPrime MCP" },
	{ value: "exa", label: "Exa", description: "API via /login exa or EXA_API_KEY; explicit keyless fallback via MCP" },
	{ value: "tinyfish", label: "TinyFish", description: "Requires TINYFISH_API_KEY" },
	{ value: "jina", label: "Jina", description: "Requires JINA_API_KEY" },
	{ value: "kagi", label: "Kagi", description: "Requires KAGI_API_KEY and Kagi Search API beta access" },
	{ value: "tavily", label: "Tavily", description: "Requires TAVILY_API_KEY" },
	{
		value: "firecrawl",
		label: "Firecrawl",
		description: "Uses Firecrawl API when FIRECRAWL_API_KEY is set; falls back to keyless mode",
	},
	{ value: "brave", label: "Brave", description: "Requires BRAVE_API_KEY" },
	{ value: "serpapi", label: "SerpAPI", description: "Requires SERPAPI_API_KEY" },
	{
		value: "kimi",
		label: "Kimi",
		description:
			"Kimi Code search (requires a Kimi Code Console key via KIMI_SEARCH_API_KEY/MOONSHOT_SEARCH_API_KEY or /login kimi-code; not MOONSHOT_API_KEY)",
	},
	{ value: "parallel", label: "Parallel", description: "Requires PARALLEL_API_KEY" },
	{ value: "synthetic", label: "Synthetic", description: "Requires SYNTHETIC_API_KEY" },
	{ value: "searxng", label: "SearXNG", description: "Requires SEARXNG_ENDPOINT or searxng.endpoint" },
	{
		value: "startpage",
		label: "Startpage",
		description: "Credential-free scrape of Startpage (Google-backed) results; may be bot-challenged",
	},
	{
		value: "duckduckgo",
		label: "DuckDuckGo",
		description: "Credential-free best-effort fallback; may be bot-challenged on datacenter/shared-egress IPs",
	},
	{
		value: "ecosia",
		label: "Ecosia",
		description: "Credential-free browser-backed scrape of Ecosia (Google-backed) results",
	},
	{
		value: "google",
		label: "Google",
		description: "Credential-free browser-backed fallback; slower and may be bot-challenged",
	},
	{
		value: "google-ai",
		label: "Google AI",
		description: "Credential-free browser-backed scrape of Google AI Overviews; extracts synthesized AI answer",
	},
	{
		value: "mojeek",
		label: "Mojeek",
		description: "Credential-free browser-backed scrape of Mojeek's independent index",
	},
	{
		value: "public",
		label: "Public Web",
		description: "Queries every credential-free engine in parallel and consolidates deduplicated results",
	},
] as const;

/** Default hard timeout for each web-search provider transport. */
export const DEFAULT_WEB_SEARCH_TIMEOUT_SECONDS = 60;

/** Maximum configurable hard timeout for each web-search provider transport. */
export const MAX_WEB_SEARCH_TIMEOUT_SECONDS = 300;

/** Supported web search providers (every option except `auto`). */
export type SearchProviderId = Exclude<(typeof SEARCH_PROVIDER_OPTIONS)[number]["value"], "auto">;

/**
 * Auto-resolution priority order. Derived from {@link SEARCH_PROVIDER_OPTIONS}
 * (minus `auto`) so the settings/setup dropdown and `resolveProviderChain()`
 * share one source of truth and never drift apart.
 */
export const SEARCH_PROVIDER_ORDER: readonly SearchProviderId[] = SEARCH_PROVIDER_OPTIONS.flatMap(option =>
	option.value === "auto" ? [] : [option.value],
);

/** Concrete provider choices (no `auto` sentinel) — for list-valued settings like order/exclude. */
export const SEARCH_PROVIDER_CHOICES = SEARCH_PROVIDER_OPTIONS.filter(option => option.value !== "auto");

export const SEARCH_PROVIDER_PREFERENCES = ["auto", ...SEARCH_PROVIDER_ORDER] as const;

/** Display labels, derived from {@link SEARCH_PROVIDER_OPTIONS}. */
export const SEARCH_PROVIDER_LABELS = Object.fromEntries(
	SEARCH_PROVIDER_OPTIONS.flatMap(option => (option.value === "auto" ? [] : [[option.value, option.label] as const])),
) as Record<SearchProviderId, string>;

export function isSearchProviderId(value: string): value is SearchProviderId {
	return SEARCH_PROVIDER_ORDER.includes(value as SearchProviderId);
}

export function isSearchProviderPreference(value: string): value is SearchProviderId | "auto" {
	return SEARCH_PROVIDER_PREFERENCES.includes(value as SearchProviderId | "auto");
}

/** Source returned by search (all providers) */
export interface SearchSource {
	title: string;
	url: string;
	snippet?: string;
	/** ISO date string or relative ("2d ago") */
	publishedDate?: string;
	/** Age in seconds for consistent formatting */
	ageSeconds?: number;
	author?: string;
}

/** Citation with text reference (LLM-mediated providers) */
export interface SearchCitation {
	url: string;
	title: string;
	citedText?: string;
}

/** Usage metrics */
export interface SearchUsage {
	inputTokens?: number;
	outputTokens?: number;
	/** Anthropic: number of web search requests made */
	searchRequests?: number;
	/** Perplexity: combined token count */
	totalTokens?: number;
}

/** Unified response across providers */
export interface SearchResponse {
	provider: SearchProviderId | "none";
	/** Synthesized answer text (LLM-mediated providers) */
	answer?: string;
	/** Search result sources */
	sources: SearchSource[];
	/** Text citations with context */
	citations?: SearchCitation[];
	/** Intermediate search queries (anthropic) */
	searchQueries?: string[];
	/** Follow-up question suggestions (provider-dependent) */
	relatedQuestions?: string[];
	/** Token usage metrics */
	usage?: SearchUsage;
	/** Model used */
	model?: string;
	/** Request ID for debugging */
	requestId?: string;
	/** Authentication mode used by the provider (e.g. oauth, api-key) */
	authMode?: string;
}

/** Provider-specific error with optional HTTP status */
export class SearchProviderError extends Error {
	constructor(
		public readonly provider: SearchProviderId,
		message: string,
		public readonly status?: number,
		/**
		 * When true, the fallback chain should stop — the browser is
		 * still open for the user to solve a CAPTCHA manually.
		 */
		public readonly captcha = false,
	) {
		super(message);
		this.name = "SearchProviderError";
	}
}
