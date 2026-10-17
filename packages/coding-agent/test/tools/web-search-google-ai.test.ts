import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { Browser, Page } from "puppeteer-core";
import { launchHeadlessBrowser } from "@oh-my-pi/pi-coding-agent/tools/browser/launch";
import { extractAnswer, waitForAnswerReady } from "@oh-my-pi/pi-coding-agent/web/search/providers/google-ai";
import { chromiumAvailable } from "./chromium-probe";

const CHROMIUM_AVAILABLE = await chromiumAvailable();

/** Long enough to clear the "too short to be an answer" floor, so the
 *  marker rules — not the length rule — are what disqualify a shell. */
const SHELL_ECHO =
	"This paragraph echoes the question back so the snapshot comfortably exceeds the minimum length that the readiness gate treats as a real answer body.";

const STREAMING_HTML = `<!doctype html><html><body>
<div id="main"></div>
<script>
let n = 0;
const main = document.getElementById("main");
const timer = setInterval(() => {
	n += 1;
	const p = document.createElement("p");
	p.textContent = "Paragraph " + n + " " + "x".repeat(40);
	main.appendChild(p);
	if (n >= 5) {
		clearInterval(timer);
		const a = document.createElement("a");
		a.className = "vIWmYe";
		a.href = "https://example.com/source";
		a.textContent = "Example source";
		main.appendChild(a);
	}
}, 300);
</script>
</body></html>`;

/**
 * These drive the polling loop against real elapsed time on purpose. Fake
 * timers cannot substitute: readiness is defined by the answer text holding
 * still across successive DOM reads from a live page, so the clock the loop
 * measures against is the one it must be verified on. Each case bounds its own
 * runtime with an explicit deadline rather than a guessed sleep.
 */
describe.skipIf(!CHROMIUM_AVAILABLE)("google-ai answer readiness", () => {
	let browser: Browser;
	let page: Page;

	beforeAll(async () => {
		browser = (await launchHeadlessBrowser({ headless: true })).browser;
	});

	afterAll(async () => {
		await browser.close();
	});

	beforeEach(async () => {
		page = await browser.newPage();
	});

	afterEach(async () => {
		await page.close();
	});

	it("waits for a streaming answer to settle instead of returning on the first poll", async () => {
		await page.setContent(STREAMING_HTML);

		const started = Date.now();
		const ready = await waitForAnswerReady(page, Date.now() + 15_000);
		const elapsed = Date.now() - started;

		expect(ready).toBe(true);
		// A loop that returned on its first sample would land well under 1.2s.
		expect(elapsed).toBeGreaterThanOrEqual(1_200);
		// Citations present → the 1.2s window, not the 4s uncited one.
		expect(elapsed).toBeLessThan(4_000);
	});

	it("keeps waiting on an uncited loading shell until the deadline", async () => {
		await page.setContent(
			`<html><body><div id="main">
				<p>${SHELL_ECHO}</p><p>Searching</p><p>Skip to previous prompt</p>
			</div></body></html>`,
		);

		const started = Date.now();
		const ready = await waitForAnswerReady(page, Date.now() + 3_000);
		const elapsed = Date.now() - started;

		expect(ready).toBe(false);
		expect(elapsed).toBeGreaterThanOrEqual(2_500);
	});

	it("accepts a citation-less answer once it has held still for the longer window", async () => {
		await page.setContent(
			`<html><body><div id="main"><p>${SHELL_ECHO}</p><p>The full rendered answer body.</p></div></body></html>`,
		);

		const started = Date.now();
		const ready = await waitForAnswerReady(page, Date.now() + 8_000);
		const elapsed = Date.now() - started;

		expect(ready).toBe(true);
		expect(elapsed).toBeGreaterThanOrEqual(3_800);
		expect(elapsed).toBeLessThan(8_000);
	});

	it("bails out as soon as a CAPTCHA appears mid-wait", async () => {
		await page.setContent(
			`<html><body><p>Our systems have detected unusual traffic from your computer network.</p></body></html>`,
		);

		const started = Date.now();
		const ready = await waitForAnswerReady(page, Date.now() + 10_000);

		expect(ready).toBe(false);
		expect(Date.now() - started).toBeLessThan(1_500);
	});

	it("extracts nothing from the mid-generation shell that was previously returned as an answer", async () => {
		// Verbatim shape of the answer recorded in the failing session log.
		await page.setContent(
			`<html><body><div id="main"><p>Searching</p><p>Skip to previous prompt</p></div></body></html>`,
		);

		const answer = await extractAnswer(page, "what is quantum tunnelling");
		// The provider's emptiness check keys off this — an empty string is what
		// turns the junk into a retryable error instead of a bogus 200.
		expect(answer ?? "").toBe("");
	});
});
