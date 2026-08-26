---
name: google-ai-research
description: Research any knowledge topic using Google's AI Mode and return a grounded, fact-based answer synthesized from the web — avoiding hallucination by querying real sources. Use this skill whenever the user wants a reliable answer to a factual question, wants to learn about a technology, concept, event, or domain, or needs information that benefits from being grounded in current internet knowledge rather than model memory. Triggers on: "what is X", "how does X work", "explain X", "tell me about X", "research X", "look up X", "find out about X", or any question where accuracy and grounding in real sources matters.
---

# Google AI Research

Use Google's AI Mode (`udm=50`) to answer factual questions and research topics. This returns an AI-synthesized answer grounded in real web sources — not model memory.

## Workflow

1. Construct the AI Mode URL:
   ```
   https://www.google.com/search?udm=50&q=<query>
   ```

2. Navigate with puppeteer `goto`.

3. Extract the full answer in one call:
   ```
   puppeteer extract_readable (format: text)
   ```
   The `text` field contains the complete AI-synthesized answer. No scrolling or pagination needed — `extract_readable` reads the full DOM, not just the visible viewport.

4. Present the answer directly. Clean it up into readable prose, preserve lists and section structure, and format any comparison data as markdown tables.

## Notes

- `udm=50` activates AI Mode — always include it.
- Navigate directly to the search URL; this bypasses cookie consent dialogs.
- `extract_readable` pulls the entire page text from the DOM in one shot — no need to scroll or paginate.
- If Google returns no AI answer (query too niche or ambiguous), present the top web result snippets instead and note that no AI summary was available.