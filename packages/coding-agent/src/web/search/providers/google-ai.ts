/**
 * Google AI Mode Web Search Provider
 *
 * Uses the bundled Chromium browser to navigate to Google's AI Mode
 * (search?udm=50) and extract the AI-synthesized answer from the DOM.
 * No API key required.
 */

import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import { parseHTML } from "linkedom";
import type { Browser, CDPSession, Page } from "puppeteer-core";
import type { UserAgentOverride } from "../../../tools/browser/launch";
import { applyStealthPatches, launchHeadlessBrowser } from "../../../tools/browser/launch";
import { extractReadableFromHtml } from "../../../tools/browser/readable";
import type { SearchResponse, SearchSource } from "../../search/types";
import { SearchProviderError } from "../../search/types";
import type { SearchParams } from "./base";
import { SearchProvider } from "./base";

const GOOGLE_AI_SEARCH_URL = "https://www.google.com/search?udm=50";
const BROWSER_TIMEOUT_MS = 45_000;
const POST_NAVIGATION_WAIT_MS = 5_000;
const MAX_SOURCES = 10;

interface SelectorSet {
	id: string;
	answer: string[];
	sourceTitle?: string[];
	sourceURL?: string[];
	sourceSnippet?: string[];
}

interface SelectorCatalog {
	sets: SelectorSet[];
}

function getSelectorsPath(): string {
	return path.join(import.meta.dir, "./google-selectors.json");
}

async function loadSelectorCatalog(): Promise<SelectorCatalog> {
	const file = Bun.file(getSelectorsPath());
	return (await file.json()) as SelectorCatalog;
}

/** Check if the page content indicates a CAPTCHA or bot wall. */
async function detectCaptcha(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const d = document as any;
		const title = d.title.toLowerCase();
		if (
			title.includes("captcha") ||
			title.includes("verify") ||
			title.includes("unusual traffic") ||
			title.includes("before you continue")
		) {
			return true;
		}
		if (
			d.querySelector(
				"#captcha-form, .g-recaptcha, .cf-turnstile, iframe[src*='recaptcha'], iframe[src*='turnstile']",
			)
		) {
			return true;
		}
		const bodyText = d.body?.innerText?.toLowerCase() ?? "";
		if (
			bodyText.includes("verify you are human") ||
			bodyText.includes("i'm not a robot") ||
			bodyText.includes("unusual traffic from your computer") ||
			bodyText.includes("our systems have detected unusual traffic")
		) {
			return true;
		}
		return false;
	});
}

/** Normalize whitespace in extracted text. */
function normalizeText(text: string): string {
	return text
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]+/g, " ")
		.trim();
}

/** Extract the AI-synthesized answer from Google AI Mode page. */
async function extractAnswer(page: Page, query: string): Promise<string | null> {
	return page.evaluate((q: string) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const d = document as any;
		const main = d.querySelector("#main, #cnt .main, #cnt");
		if (!main) return "";

		let text = main.innerText ?? "";

		// Strip everything up to and including "Search Results"
		const searchResultsIdx = text.indexOf("Search Results");
		if (searchResultsIdx >= 0) {
			text = text.slice(searchResultsIdx + "Search Results".length);
		}

		// Strip Google AI Mode navigation header tokens that appear before the
		// actual answer: "AI Mode", "All", "Images", "Videos", "News", "More",
		// "Sign in", "AI Mode Conversation", etc. These often appear on a
		// single line without newlines, so strip them as a prefix pattern.
		text = text.replace(/^(?:\s*(?:AI Mode|All|Images|Videos|News|More|Sign in|Search)\s*)+\s*/i, "");

		// Strip the query echo and "AI Mode Conversation:" / "Conversation" prefix
		text = text.replace(/^(?:AI Mode\s+)?[Cc]onversation[:\s]+/i, "");
		// Strip trailing conversational filler from the AI response.
		// These appear before source references ("Encyclopedia Britannica +1")
		// so match up to the next source reference or end of text.
		text = text.replace(/(?:(?:What|Which) would you like|Are you interested in)[^.?!]*[?.!]\s*/gi, "");
		const lines = text.split("\n");
		let firstContentIdx = -1;
		for (let i = 0; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			if (trimmed.length > 0) {
				firstContentIdx = i;
				break;
			}
		}
		if (firstContentIdx >= 0) {
			const firstLine = lines[firstContentIdx].trim();
			// Check if first line is or contains the query echo.
			// Stop words are excluded from comparison because Google AI Mode
			// sometimes drops articles/prepositions in the query echo.
			const STOP_WORDS =
				/^(?:a|an|the|is|are|was|were|be|been|being|do|does|did|will|would|could|should|may|might|shall|can|need|dare|ought|used|to|of|in|for|on|with|at|by|from|as|into|through|during|before|after|above|below|between|out|off|over|under|again|further|then|once|here|there|when|where|why|how|all|both|each|few|more|most|other|some|such|no|nor|not|only|own|same|so|than|too|very|just|because|but|and|or|if|while|about|against|up|down)$/;
			const contentWords = (s: string) =>
				s
					.toLowerCase()
					.replace(/[^a-z0-9\s]/g, "")
					.split(/\s+/)
					.filter((w: string) => w.length > 0 && !STOP_WORDS.test(w));
			const nqWords = contentWords(q);
			// The echo may be the entire first line or a prefix before the answer
			const cleanedLine = firstLine
				.toLowerCase()
				.replace(/[^a-z0-9\s]/g, "")
				.trim();
			const lineWords = cleanedLine.split(/\s+/).filter((w: string) => w.length > 0 && !STOP_WORDS.test(w));
			const prefixMatch = nqWords.length > 0 && nqWords.every((w: string, i: number) => lineWords[i] === w);
			if (prefixMatch) {
				// Walk the original line words, consuming query words and
				// any interleaved stop words, then stop at the first
				// content word that isn't part of the query echo.
				// Find the query echo position — it starts at the beginning
				// of the cleaned line (possibly with leading stop words)
				const eqIdx = 0;
				if (eqIdx >= 0) {
					const afterQuery = firstLine.slice(eqIdx);
					const origWords = afterQuery.split(/\s+/);
					let nqIdx = 0;
					let stripEnd = 0;
					for (const ow of origWords) {
						const owClean = ow.toLowerCase().replace(/[^a-z0-9]/g, "");
						if (nqIdx >= nqWords.length) break;
						if (owClean === nqWords[nqIdx]) {
							nqIdx++;
						} else if (!STOP_WORDS.test(owClean)) {
							break;
						}
						stripEnd += ow.length + 1;
					}
					const suffix = afterQuery.slice(stripEnd).trim();
					if (suffix.length > 0) {
						// Echo was a prefix — keep the rest of the line
						lines[firstContentIdx] = suffix;
					} else {
						// Echo was the entire line — remove it
						lines.splice(firstContentIdx, 1);
					}
				}
			}
		}
		text = lines.join("\n");

		// Strip trailing boilerplate
		const boilerplate = [
			"Are you researching the chemical",
			"Are you looking to write code",
			"AI can make mistakes, so double-check responses",
			"Privacy Policy",
			"Terms of Service",
			"make a legal removal request",
		];
		const minBoilerplatePos = Math.max(0, text.length - 800);
		for (const marker of boilerplate) {
			const idx = text.indexOf(marker, minBoilerplatePos);
			if (idx >= 0) {
				text = text.slice(0, idx).trim();
			}
		}

		// Strip source reference blocks: "Domain Name\n+N\n" but preserve if part of content
		text = text.replace(/\n([A-Za-z][A-Za-z0-9\s.&()-]+)\n\+\d+\s*\n/g, "\n");
		text = text.replace(/\n([A-Za-z][A-Za-z0-9\s.&()-]+)\n\+\d+\s*$/g, "");

		// Also strip orphan +N lines
		text = text.replace(/\n\s*\+\d+\s*\n/g, "\n");

		return text.trim();
	}, query);
}

/** Extract search result sources from the AI Mode page. */
async function extractSources(page: Page, maxResults: number): Promise<SearchSource[]> {
	// Google AI Mode citation links use class vIWmYe. The link text is
	// empty; the title and snippet live in the parent card element.
	// We also accept H23r4e for older layouts.
	return page.evaluate((max): SearchSource[] => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const d = document as any;
		const results: SearchSource[] = [];
		const seen = new Set<string>();

		const citationLinks = d.querySelectorAll("a.vIWmYe[href], a.H23r4e[href]");
		for (const a of citationLinks) {
			const url = a.getAttribute("href");
			if (!url || seen.has(url)) continue;
			seen.add(url);

			// Title from aria-label (cleanest source), strip "Opens in a new tab." suffix
			let title = (a.getAttribute("aria-label") || "").replace(/\.\s*Opens in a new tab\.?$/i, "").trim();

			// Snippet from parent card text (everything after the title)
			let snippet: string | undefined;
			const parent = a.closest(".cRH23c, [class*='g7lqo']") || a.parentElement;
			if (parent) {
				const fullText = (parent.innerText ?? "").trim();
				if (title && fullText.includes(title)) {
					const afterTitle = fullText.slice(fullText.indexOf(title) + title.length).trim();
					if (afterTitle.length > 10) snippet = afterTitle.slice(0, 240);
				}
			}

			if (!title) {
				try {
					title = new URL(url).hostname.replace(/^www\./, "");
				} catch {
					title = url;
				}
			}
			results.push({ title, url, snippet });
			if (results.length >= max) break;
		}
		return results;
	}, maxResults);
}

/** Build the Google AI Mode search URL. */
function buildSearchUrl(query: string): string {
	const url = new URL(GOOGLE_AI_SEARCH_URL);
	url.searchParams.set("q", query);
	return url.toString();
}

async function appendSelectorSet(set: SelectorSet): Promise<void> {
	const catalog = await loadSelectorCatalog();
	catalog.sets.push(set);
	await Bun.write(getSelectorsPath(), `${JSON.stringify(catalog, null, "\t")}\n`);
}

/**
 * Attempt to heal Google AI Mode selectors from an HTML snapshot.
 *
 * For Google AI Mode (udm=50), the page structure is deliberately different
 * from traditional Google Search. Uses heuristics to discover selectors.
 */
export async function healGoogleSelectors(htmlSnapshot: string): Promise<SelectorSet> {
	const { document } = parseHTML(htmlSnapshot);

	// Check if this looks like AI Mode (udm=50)
	const hasAIMode = htmlSnapshot.includes("udm=50") || htmlSnapshot.includes("AI Mode");

	if (hasAIMode) {
		// AI Mode uses #main / #cnt .main for content
		const main = document.querySelector("#main");
		if (main) {
			const newSet: SelectorSet = {
				id: `healed-aim-${Date.now()}`,
				answer: ["#main", "#cnt .main", "#cnt"],
				sourceTitle: [],
				sourceURL: ["a.H23r4e[href]"],
				sourceSnippet: [],
			};
			await appendSelectorSet(newSet);
			return newSet;
		}
	}

	// Fallback: old-style search with data-attrid
	const dataAttrid = document.querySelector('[data-attrid*="wa:"]');
	if (dataAttrid) {
		const attrid = dataAttrid.getAttribute("data-attrid");
		const tag = dataAttrid.tagName.toLowerCase();
		const selector = `${tag}[data-attrid="${attrid}"]`;
		const test = document.querySelector(selector);
		if (test?.textContent?.trim()) {
			const newSet: SelectorSet = {
				id: `healed-${Date.now()}`,
				answer: [selector, `${tag}[data-attrid*='wa:']`],
				sourceTitle: ["h3", "a h3"],
				sourceURL: ["a[href]", "a[href^='/url?q=']"],
				sourceSnippet: [".VwiC3b", "span"],
			};
			await appendSelectorSet(newSet);
			return newSet;
		}
	}

	// Heuristic: largest text block
	let bestElement: Element | null = null;
	let bestLength = 0;
	const candidates = document.querySelectorAll("div, section, article");
	for (const el of candidates) {
		const tag = el.tagName.toLowerCase();
		if (tag === "nav" || tag === "footer" || tag === "header") continue;

		const text = el.textContent ?? "";
		if (text.length > bestLength && text.length > 200) {
			bestLength = text.length;
			bestElement = el;
		}
	}

	if (bestElement) {
		const className = bestElement.getAttribute("class") ?? "";
		const selectors: string[] = [];
		if (className) {
			const classes = className.split(/\s+/).filter((c: string) => c.length > 2);
			if (classes.length > 0) {
				selectors.push(`.${classes[0]}`);
			}
		}
		selectors.push(bestElement.tagName.toLowerCase());

		const newSet: SelectorSet = {
			id: `heuristic-${Date.now()}`,
			answer: selectors,
			sourceTitle: [],
			sourceURL: ["a[href]"],
			sourceSnippet: [],
		};
		await appendSelectorSet(newSet);
		return newSet;
	}

	throw new Error(
		"Could not identify new selectors from HTML snapshot. The page layout may have changed substantially.",
	);
}

/** Search provider for Google AI Mode web search. */
export class GoogleAIProvider extends SearchProvider {
	readonly id = "google-ai";
	readonly label = "Google AI";

	/**
	 * Retained browser reference when a CAPTCHA is detected.
	 * Kept alive so the user can solve the CAPTCHA manually via the
	 * browser tool, then retry the search which reuses this instance.
	 */
	#captchaBrowser: Browser | null = null;

	isAvailable(): boolean {
		// Always available because Chromium is bundled with the app
		return true;
	}

	async search(params: SearchParams): Promise<SearchResponse> {
		// Reuse the retained CAPTCHA browser if it is still connected
		let browser: Browser;
		if (this.#captchaBrowser) {
			try {
				// Verify the browser process is still alive
				await this.#captchaBrowser.version();
				browser = this.#captchaBrowser;
			} catch {
				// Browser gone — discard and launch fresh
				this.#captchaBrowser = null;
				const launched = await launchHeadlessBrowser({ headless: false });
				browser = launched.browser;
			}
		} else {
			const launched = await launchHeadlessBrowser({ headless: false });
			browser = launched.browser;
		}

		let captchaDetected = false;
		try {
			const pages = await browser.pages();
			const page = pages[0] ?? (await browser.newPage());
			const stealthState: {
				browserSession: CDPSession | null;
				override: UserAgentOverride | null;
			} = { browserSession: null, override: null };
			await applyStealthPatches(browser, page, stealthState);

			const url = buildSearchUrl(params.query);
			await page.goto(url, {
				waitUntil: "domcontentloaded",
				timeout: BROWSER_TIMEOUT_MS,
			});

			// Allow JS-rendered content and AI response to settle
			await Bun.sleep(POST_NAVIGATION_WAIT_MS);

			// CAPTCHA / bot-wall detection
			if (await detectCaptcha(page)) {
				const captchaBehavior = params.captchaBehavior ?? "wait";
				const captchaTimeout = params.captchaTimeout ?? 90;

				if (captchaBehavior === "error") {
					// Immediate fallback: keep browser open, throw error
					captchaDetected = true;
					this.#captchaBrowser = browser;
					throw new SearchProviderError(
						"google-ai",
						`Google served a CAPTCHA. The browser window is still open — solve the CAPTCHA there, then retry the search.`,
						undefined,
						true,
					);
				}

				// "wait" mode: notify user and wait for them to solve the CAPTCHA
				const notify = params.onUpdate;
				if (notify) {
					notify(`CAPTCHA detected — solve it in the browser window (${captchaTimeout}s remaining)`);
				}

				const CAPTCHA_TIMEOUT_MS = captchaTimeout * 1_000;
				const deadline = Date.now() + CAPTCHA_TIMEOUT_MS;

				while (Date.now() < deadline) {
					const remaining = deadline - Date.now();
					if (remaining <= 0) break;

					try {
						// Wait for either navigation (redirect after CAPTCHA solve)
						// or content to appear (in case of overlay CAPTCHA)
						await Promise.race([
							page.waitForNavigation({ timeout: remaining }).catch(() => null),
							page.waitForSelector("#main, #cnt", { timeout: remaining }).catch(() => null),
						]);
					} catch {
						// Timeout or navigation error — break to check CAPTCHA status
						break;
					}

					// Brief settle time for page to fully load after navigation
					await Bun.sleep(1_500);

					// Check if CAPTCHA is actually solved (not just a page refresh)
					if (!(await detectCaptcha(page))) {
						// CAPTCHA solved — extract results
						let answer = await extractAnswer(page, params.query);
						if (answer) {
							answer = normalizeText(answer);
						}

						const maxResults = Math.min(
							params.numSearchResults ?? params.limit ?? MAX_SOURCES,
							MAX_SOURCES,
						);
						const sources = await extractSources(page, maxResults);

						if (!answer) {
							const html = await page.content();
							const url = buildSearchUrl(params.query);
							const readable = await extractReadableFromHtml(html, url, "text");
							if (readable?.text) {
								answer = normalizeText(readable.text);
							}
						}

						// Success — close browser and clear CAPTCHA reference
						this.#captchaBrowser = null;
						captchaDetected = false;
						try {
							await browser.close();
						} catch (closeErr) {
							logger.error("Failed to close browser in GoogleAIProvider", { error: closeErr });
						}

						if (!answer && sources.length === 0) {
							throw new SearchProviderError(
								"google-ai",
								"Google AI Mode returned no extractable content after CAPTCHA solve.",
							);
						}

						return {
							provider: "google-ai",
							answer: answer ?? undefined,
							sources,
						};
					}

					// CAPTCHA still present — notify remaining time and continue waiting
					const remainingSec = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
					if (notify && remainingSec > 0) {
						notify(`CAPTCHA still present — solve it in the browser (${remainingSec}s remaining)`);
					}
				}

				// Timeout expired — keep browser open, let fallback chain continue
				captchaDetected = true;
				this.#captchaBrowser = browser;
				throw new SearchProviderError(
					"google-ai",
					`Google served a CAPTCHA and the ${captchaTimeout}s timeout expired. The browser window is still open — you can solve the CAPTCHA there and retry the search.`,
					undefined,
					true,
				);
			}

			// Primary: extract AI answer main content text (pass query to strip echo)
			let answer = await extractAnswer(page, params.query);
			if (answer) {
				answer = normalizeText(answer);
			}

			// Extract cited source links
			const maxResults = Math.min(
				params.numSearchResults ?? params.limit ?? MAX_SOURCES,
				MAX_SOURCES,
			);
			const sources = await extractSources(page, maxResults);

			// Fallback: if no answer, try extracting readable content from page HTML
			if (!answer) {
				const html = await page.content();
				const readable = await extractReadableFromHtml(html, url, "text");
				if (readable?.text) {
					answer = normalizeText(readable.text);
				}
			}

			// If we couldn't extract anything meaningful, throw so the fallback chain proceeds
			if (!answer && sources.length === 0) {
				throw new SearchProviderError(
					"google-ai",
					"Google AI Mode returned no extractable content. This may be due to layout changes. Call healGoogleSelectors() with the page HTML to update selectors.",
				);
			}

			// Success — close the browser and clear any retained CAPTCHA reference
			this.#captchaBrowser = null;
			try {
				await browser.close();
			} catch (closeErr) {
				logger.error("Failed to close browser in GoogleAIProvider", { error: closeErr });
			}

			return {
				provider: "google-ai",
				answer: answer ?? undefined,
				sources,
			};
		} catch (err) {
			if (err instanceof SearchProviderError) throw err;
			throw new SearchProviderError("google-ai", err instanceof Error ? err.message : String(err));
		} finally {
			// Close the browser unless we are intentionally keeping it open for CAPTCHA solving
			if (!captchaDetected) {
				try {
					await browser.close();
				} catch (closeErr) {
					logger.error("Failed to close browser in GoogleAIProvider", { error: closeErr });
				}
			}
		}
	}
}
