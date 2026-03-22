# Ask and Debug Modes — Original Idea

Brief for two new modes in omp, analogous to Cursor's Ask and Debug modes.

---

## Motivation

Cursor exposes a mode selector in its composer that lets users switch between distinct interaction postures:

- **Ask** — for querying and understanding code without any risk of changes being made
- **Agent** — for implementing changes (the default)
- **Debug** — for systematic, evidence-driven debugging with runtime instrumentation

omp currently operates in a single posture: full agentic mode with write access, tools enabled, and no built-in safeguards against accidental changes. Adding Ask and Debug as named modes would give users the same intentional context-switching without leaving the tool.

---

## Ask mode

**The problem it solves**: sometimes you want to understand the codebase — trace a call path, get an explanation of a pattern, check what a function does — without the agent making any changes. Today there is no way to signal this intent to the agent; a poorly worded question can trigger edits.

**The idea**: a toggle (`/ask`) that puts the session into a read-only, conversational posture. The agent answers questions, cites file paths and line numbers, traces logic, and suggests approaches — but refuses to make any edits or run commands that mutate state. If asked to make a change, it declines and prompts the user to switch back to Agent mode.

This must be enforced in two layers:
- a session-scoped Ask-mode prompt/context override
- a guaranteed execution-time guard that still blocks writes even when no optional extensions are loaded

**What the user gets**:
- Confidence that nothing will be modified while exploring
- Answers with specific file and line references, not paraphrases
- Clarification requests when a question is ambiguous
- Proportional responses — a direct question gets a direct answer, not a plan

---

## Debug mode

**The problem it solves**: diagnosing a bug with an AI agent often collapses into guess-and-apply cycles: the agent makes a change, it fails, it makes another, and so on. This burns context and leaves the codebase in an indeterminate state.

**The idea**: a toggle (`/debug`) that puts the session into a hypothesis-driven, evidence-first posture. The agent reasons about the failure before touching the code, instruments strategically to confirm or refute its hypotheses, waits for the user to reproduce the issue, analyzes the runtime evidence, and only then proposes a fix. Instrumentation is explicitly ephemeral — removed only after the fix is verified.

For omp, Debug mode should:
- switch to the resolved slow model and `high` thinking level while active
- inject its guidance using the same session custom-message pattern as `/plan`
- bundle `ask_user` by default as the primary reproduce/confirm UX
- fall back to `extension_ui_request { method: "confirm" }` only for hosts/clients that cannot surface the `ask_user` flow

**What the user gets**:
- The agent states what it thinks is wrong and why before any code changes
- Structured NDJSON instrumentation mapped to explicit hypotheses
- A clear reproduce → observe → confirm loop
- Fixes backed by runtime evidence, not guesses
- A clean codebase at the end: instrumentation removed, speculative changes reverted

---

## Relationship to existing omp features

| | Ask | Debug |
|---|---|---|
| Similar to (omp) | `/plan` (read-only posture for planning) | `oracle` agent (deep reasoning advisor) |
| Unlike (omp) | Plan mode is still write-capable after plan approval | Oracle is a blocking sub-agent; debug mode is interactive |
| Implemented as | Slash command + session context injection + guaranteed tool guard | Slash command + model elevation + session context injection |

---

## Scope decisions

### In scope for v1

- Ask mode: two-layer enforcement — prompt/context override + guaranteed runtime tool-call blocking (tools remain in the active set but are rejected at execution time with an error returned to the model; prompt alone is not sufficient)
- Debug mode: local HTTP log ingestion server for JS/TS (same approach as Cursor); other languages use direct NDJSON append — this split is the right v1 scope, not a simplification to skip
- Debug mode: `ask_user` bundled by default as a prerequisite dependency for the reproduce/confirm loop
- RPC protocol support: new `set_ask_mode` / `set_debug_mode` command types in `RpcCommand`, a `mode` field in `RpcSessionState`, and client support for confirm-style `extension_ui_request` flows
- Mode indicator in the status bar; no separate UI selector needed beyond the slash command

### Out of scope for v1

- Ask mode does not restrict model or thinking level (unnecessary overhead for Q&A)
- Print mode (`-p`) does not need mode enforcement — user controls the prompt directly

---

## Related docs

- `ask-debug-modes.md` — implementation research and proposed design
- `cursor-prompt-reference.md` — verbatim system prompt injections captured from Cursor
