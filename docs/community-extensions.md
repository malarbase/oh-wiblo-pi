# Community Extensions — Research Notes

This document surveys notable community extensions for the pi coding agent ecosystem. For each extension, it notes what the built-in codebase already provides, what gap the extension fills, and whether the extension is a candidate for adoption or reference.

---

## How to read this doc

Each section uses this structure:

- **What it does** — the extension's purpose
- **Built-in coverage** — what `packages/coding-agent/src` or `packages/tui/src` already provides
- **Gap filled** — what the extension adds beyond the built-in
- **Adopt / reference / skip** — recommendation

---

## pi-permission-system

**Repo**: [MasuRii/pi-permission-system](https://github.com/MasuRii/pi-permission-system)

**What it does**: centralized, policy-based permission enforcement for tool calls, bash commands, MCP operations, skills, and special operations. Policy is expressed in a JSONC file with `allow / deny / ask` states per tool/pattern. The `ask` state shows a TUI confirmation dialog before executing.

**Built-in coverage**: the `tool_call` extension hook (in `src/extensibility/extensions/wrapper.ts`) already supports blocking tool calls by returning `{ block: true, reason }`. Plan mode uses a similar guard (`src/tools/plan-mode-guard.ts`). There is no built-in general-purpose policy layer.

**Gap filled**:
- Declarative JSONC policy file with wildcards (no code needed to configure)
- `before_agent_start` hook strips denied tools from the `Available tools:` section of the system prompt, preventing "try another tool" behavior
- Three-state policy (`allow / deny / ask`) — `ask` shows a TUI confirmation dialog before the tool runs
- Per-agent YAML frontmatter overrides for agent-specific policies
- Subagent permission forwarding — forwards `ask` confirmations from non-UI subagents to the main interactive session
- Structured JSONL audit log of all permission decisions

**Relationship to ask/debug modes**: the `tool_call` hook pattern this extension uses is the recommended implementation path for Ask mode's runtime write-tool denial. See `ask-debug-modes.md` — Proposed design → Ask mode → Where the execution guard lives.

**Adopt / reference**: **reference**. The read-only recipe in its README directly maps to Ask mode:
```json
{
  "tools": { "read": "allow", "grep": "allow", "find": "allow", "ls": "allow", "write": "deny", "edit": "deny" }
}
```

---

## pi-ask-user

**Repo**: [edlsh/pi-ask-user](https://github.com/edlsh/pi-ask-user)

**What it does**: registers an `ask_user` tool that presents an interactive TUI dialog — single-select, multi-select, or freeform editor — and returns the user's answer as a typed tool result.

**Built-in coverage**: no equivalent built-in tool. The TUI primitives (`SelectList`, `Editor`, `Container`, `DynamicBorder`) used by the extension are all present in `packages/tui/src/components/`. The extension uses `ctx.ui.custom()` from the extension API and falls back to `ctx.ui.input()` when no TUI is available.

**Gap filled**: a general-purpose interactive user-input tool the agent can call at any point in its turn to gather structured input before continuing.

**Relationship to ask/debug modes**: directly referenced in `ask-debug-modes.md` as the recommended mechanism for the Debug mode reproduction confirmation loop (`ask_user` with "Proceed" / "Mark as fixed" options replaces Cursor's `<reproduction_steps>` tag-detection approach).

**Adopt / reference**: **adopt** — needed for Debug mode's user feedback loop. Already referenced in `ask-debug-modes.md`.

---

## btw.ts (BTW side chat)

**Repo**: [mitsuhiko/agent-stuff — btw.ts](https://github.com/mitsuhiko/agent-stuff/blob/main/pi-extensions/btw.ts)

**What it does**: adds a `/btw` command and `Ctrl+Alt+B` shortcut that opens a floating side-chat overlay running a separate agent session seeded with the current main session's context. The side chat shares context with the main conversation but runs independently. On close, the user can inject a summary of the side thread back into the main conversation.

**Built-in coverage**: none. The codebase has no side-chat or parallel session overlay. TUI overlays exist (`packages/tui/src/tui.ts` `showOverlay`) but are used for modals, not secondary agent sessions. Subagents (`task` tool) run as delegates, not interactive sidecars.

**Gap filled**: a "thinking out loud" / "quick question without polluting main context" pattern. Key capabilities:
- Floating `BtwOverlay` TUI component anchored top-center with configurable width/height
- Separate `AgentSession` seeded with main session messages (full context awareness)
- Tool calls rendered inline in the overlay transcript
- Thread persisted across session restarts via `pi.appendEntry()`
- "Summarize and inject" — on close, compresses the side thread into a single message and injects it into the main conversation via `pi.sendUserMessage()`
- Session restore on branch/tree navigation

**Adopt / reference**: **reference** — useful pattern for any scenario where exploratory thinking should be isolated from the main conversation. Not a direct implementation need for ask/debug modes but demonstrates the `createAgentSession` SDK API and overlay TUI pattern.

**Implementation notes**:
- Uses `createAgentSession` from `@mariozechner/pi-coding-agent` to spin up a fully independent session with no extension loading (`createBtwResourceLoader` returns an empty extension runtime)
- Model and thinking level are inherited from the main session at open time; if the model changes, the side session is discarded and recreated
- `buildSessionContext` seeds the side session with main-session messages so the BTW agent has full conversation awareness
- The "summarize" step uses `thinkingLevel: "off"` to keep it cheap

---

## answer.ts (Q&A extraction)

**Repo**: [mitsuhiko/agent-stuff — answer.ts](https://github.com/mitsuhiko/agent-stuff/blob/main/pi-extensions/answer.ts)

**What it does**: adds an `/answer` command and `Ctrl+.` shortcut. When triggered, it reads the last assistant message, uses a small LLM call (preferring Codex mini, falling back to Claude Haiku) to extract all questions from it as structured JSON, then presents an interactive multi-question TUI where the user navigates between questions and types answers. On submission, sends the compiled Q&A back as a user message.

**Built-in coverage**: an example `/qna` command exists at `packages/coding-agent/examples/hooks/qna.ts` but is not a shipped extension. The TUI primitives (`Editor`, `wrapTextWithAnsi`, `visibleWidth`) are all available in `packages/tui/src/`.

**Gap filled**:
- Structured multi-question navigation TUI (progress dots, Tab/Shift+Tab between questions, Enter advances)
- Separate fast LLM call for question extraction (keeps extraction cheap; prefers Codex mini over the main model)
- Confirmation dialog before final submission
- `pi.sendMessage({ customType: "answers", triggerTurn: true })` pattern — sends a typed custom entry into the session log and triggers a new agent turn

**Adopt / reference**: **reference** — demonstrates the `complete()` SDK function for lightweight one-shot LLM calls within an extension, the `customType` session entry pattern, and multi-screen TUI navigation. Not needed for ask/debug modes.

---

## pi-rewind

**Repo**: [arpagon/pi-rewind](https://github.com/arpagon/pi-rewind)

**What it does**: git-based checkpoint/rewind system. Creates a snapshot of the working tree after each write/edit/bash tool call (1 per turn, deduped if unchanged). Provides a `/rewind` command with checkpoint picker, diff preview, and restore options (files + conversation, files only, conversation only). Adds a redo stack, branch safety, smart filtering, and auto-pruning of old sessions.

**Built-in coverage**: `checkpoint` and `rewind` tools exist as first-class built-ins in `src/tools/checkpoint.ts`, state managed in `src/session/agent-session.ts` (`#checkpointState`, `#applyRewind`). Built-in rewind is scoped to context/message pruning, not disk-state snapshots.

**Gap filled**: disk-state snapshots. The built-in rewind operates on conversation context (message history, tool call state); it does not capture or restore file system changes. pi-rewind adds:
- Git ref-based snapshots of working tree after every modifying turn
- `/rewind` command with interactive checkpoint picker and diff preview before restore
- `Esc+Esc` shortcut for quick files-only rewind
- Redo stack (multi-level undo/redo)
- Branch safety (blocks cross-branch restore)
- Smart filtering (excludes `node_modules`, `.venv`, files >10MiB, dirs >200 files)
- Footer status indicator showing checkpoint count
- Resume checkpoint on session start; prune stale checkpoints from previous sessions

**Adopt / reference**: **adopt candidate** — fills a real gap. The built-in checkpoint/rewind has no disk-state recovery. Users who want "undo the last file edit" currently have no built-in path. The two-layer architecture (`core.ts` for pure git ops, `index.ts` for pi event wiring) is clean and independently testable.

**Implementation notes**:
- Uses `pi.on("tool_execution_end")` to trigger checkpoint after each modifying tool call
- Snapshots stored as git refs (`refs/pi-rewind/<sessionId>/<n>`) — survives process restarts
- `createCheckpoint` benchmarks at ~60–142ms on repos up to 182K files — imperceptible overhead
- Careful to never snapshot `node_modules`, `.venv`, or large binary files

---

## multi-edit.ts

**Repo**: [mitsuhiko/agent-stuff — multi-edit.ts](https://github.com/mitsuhiko/agent-stuff/blob/main/pi-extensions/multi-edit.ts)

**What it does**: replaces the built-in `edit` tool with an extended version that supports a `multi` parameter (array of `{path, oldText, newText}` edits applied in sequence, potentially across multiple files) and a `patch` parameter (Codex-style `*** Begin Patch … *** End Patch` format). Includes a preflight virtual-filesystem pass before mutating real files, positional ordering for same-file edits, and a context-aware diff renderer.

**Built-in coverage**: **largely redundant**. The built-in `edit` tool in `src/patch/` already supports multiple modes including patch-based application (`applyPatch` in `src/patch/applicator.ts`). The built-in implementation uses hashline and replace modes plus a fuzzy applicator. There is no built-in `multi` array parameter, but Codex-style patch is supported.

**Gap filled** (incremental over built-in):
- `multi` array parameter — apply a batch of `oldText → newText` replacements across one or more files in a single tool call, reducing tool call overhead for multi-location edits
- Explicit positional ordering for same-file multi-edits (sorts by occurrence position before applying, making order-independent batch edits safe)
- Preflight virtual-filesystem dry run before any real write, with early failure if any oldText is not found
- Diff output per edit for multi-mode

**Adopt / reference**: **reference** — the `multi` array parameter and preflight dry-run are worth considering as additions to the built-in `edit` tool. The Codex-style patch parser (`parsePatch`) is a useful reference for the patch format spec.

---

## pi-web-access

**Repo**: [nicobailon/pi-web-access](https://github.com/nicobailon/pi-web-access)

**What it does**: extends web capabilities with `web_search` (Perplexity/Gemini with smart fallbacks, multi-query with curation UI) and `fetch_content` (handles YouTube videos, local video files, GitHub repo cloning, PDFs, blocked pages via Jina Reader/Gemini fallback). Zero-config via Chrome cookie auth for Gemini; optional API keys.

**Built-in coverage**: `web_search` tool exists at `src/web/search/` with provider support. `fetch` tool exists at `src/tools/fetch.ts` with scrapers. Basic web coverage is present.

**Gap filled** (beyond built-in):
- **YouTube / video understanding** — Gemini-based full video analysis (transcripts, visual descriptions, frame extraction at timestamps). Not in built-in.
- **Local video files** — analysis via Gemini Files API. Not in built-in.
- **GitHub repo cloning** — GitHub URLs cloned locally so the agent gets real file contents + path, not rendered HTML. Not in built-in.
- **PDF extraction** — text extraction saved to `~/Downloads/` as markdown. Not in built-in.
- **Multi-query search curation UI** — browser-based result curation with countdown, Ctrl+Shift+S shortcut. Not in built-in.
- **Smart fallback chain** — Readability → RSC parser → Jina Reader → Gemini URL Context → Gemini Web for blocked pages. More robust than built-in.
- **Chrome cookie auth** — reads live browser session to use Gemini Web without API keys.
- **Auto-condense** — multi-query searches are automatically synthesized into a deduplicated briefing via a configurable LLM.

**Adopt / reference**: **reference** — the GitHub-cloning and video-understanding capabilities are the most novel and fill real gaps. The fallback chain architecture for blocked pages is worth studying for improving the built-in `fetch` scraper robustness.

---

## Summary table

| Extension | Built-in coverage | Gap | Recommendation |
|---|---|---|---|
| [pi-permission-system](https://github.com/MasuRii/pi-permission-system) | `tool_call` hook exists | Declarative policy file, `ask` confirmation, system prompt sanitization, audit log | Reference for Ask mode implementation |
| [pi-ask-user](https://github.com/edlsh/pi-ask-user) | TUI primitives present; no `ask_user` tool | Interactive user-input tool callable from agent turns | Adopt — needed for Debug mode |
| [btw.ts](https://github.com/mitsuhiko/agent-stuff/blob/main/pi-extensions/btw.ts) | None | Side-chat overlay with independent agent session + context seeding | Reference — demonstrates `createAgentSession` pattern |
| [answer.ts](https://github.com/mitsuhiko/agent-stuff/blob/main/pi-extensions/answer.ts) | Example `/qna` exists | Structured multi-question TUI, fast extraction model, `customType` entry + `triggerTurn` | Reference — demonstrates `complete()` + custom session entries |
| [pi-rewind](https://github.com/arpagon/pi-rewind) | Context rewind built-in; no disk-state snapshots | Git-based working-tree snapshots, diff preview, redo stack | Adopt candidate — fills real disk-state undo gap |
| [multi-edit.ts](https://github.com/mitsuhiko/agent-stuff/blob/main/pi-extensions/multi-edit.ts) | `edit` with patch support built-in | `multi` batch array, preflight dry-run | Reference — `multi` param worth adding to built-in |
| [pi-web-access](https://github.com/nicobailon/pi-web-access) | `web_search` + `fetch` built-in | YouTube/video, GitHub cloning, PDF, multi-query curation, Chrome cookie auth | Reference — video + GitHub cloning fill real gaps |
