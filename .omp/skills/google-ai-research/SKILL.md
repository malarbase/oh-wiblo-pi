---
name: google-ai-research
description: Research any knowledge topic using Google's AI Mode and return a grounded, fact-based answer synthesized from the web — avoiding hallucination by querying real sources. Use this skill whenever the user wants a reliable answer to a factual question, wants to learn about a technology, concept, event, or domain, or needs information that benefits from being grounded in current internet knowledge rather than model memory. Triggers on: "what is X", "how does X work", "explain X", "tell me about X", "research X", "look up X", "find out about X", or any question where accuracy and grounding in real sources matters.
---

# Google AI Research

Use Google's AI Mode (`udm=50`) to answer factual questions and research topics. Returns an AI-synthesized answer grounded in real web sources.

## Workflow

### New Query

1. Construct the AI Mode URL:
   ```
   https://www.google.com/search?udm=50&q=<query>
   ```

2. Open with `browser` tool (`action: "open"`).

3. Extract the full answer — use `page.evaluate` with `document.body.innerText`:
   ```js
   page.evaluate(() => document.body.innerText.slice(0, 20000))
   ```
   This is the **only reliable extraction method** for AI Mode. CSS selectors (`document.querySelector('[data-ai-mode-content]')`, `.aimode-result`, `[jsname]`) do not match AI Mode DOM. `extract_readable` also fails. If 20k chars is truncated, re-call with `.slice(20000, 40000)`.

4. Present the answer. Clean into readable prose; preserve lists, sections, comparison tables as markdown.

### Shared Conversation URLs

When given a `share.google/aimode/...` URL:

1. Open with `browser` (`action: "open"`). The URL redirects to the full AI Mode search page containing the conversation.
2. Extract with the same `page.evaluate(() => document.body.innerText)` approach above.
3. The page text includes both the user's original query and the AI response — extract from the response portion.

**Do not** use `read` on shared Google URLs — it returns HTML without the AI-synthesized content.

## Notes

- `udm=50` activates AI Mode — always include it in search URLs.
- Navigate directly to the search URL; this bypasses cookie consent dialogs.
- If Google returns no AI answer (query too niche/ambiguous), fall back to top web result snippets and note no AI summary was available.
