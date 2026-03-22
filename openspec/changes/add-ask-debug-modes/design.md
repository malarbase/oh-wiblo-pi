## Context

omp already has two relevant primitives in production:

- `/plan`, which is implemented as a session mode with state on `AgentSession`, UI toggling in `InteractiveModeContext`, and a per-turn custom context message injected alongside the active user prompt
- the bundled `oracle` sub-agent, which is a useful structural reference for elevated-reasoning diagnostic framing but is not itself an interactive mode

Ask mode and Debug mode should reuse the same architecture as `/plan` wherever possible: slash-command entry in `packages/coding-agent/src/slash-commands/builtin-registry.ts`, mode/UI wiring in `packages/coding-agent/src/modes/interactive-mode.ts`, session state in `packages/coding-agent/src/session/agent-session.ts`, and status-line rendering in `packages/coding-agent/src/modes/components/status-line/`.

The verbatim Cursor prompt text for both modes is captured in `docs/cursor-prompt-reference.md` and is the canonical source for prompt content.

**Constraints**:
- Ask mode must not rely solely on the prompt to block writes; execution-time enforcement must still work when no optional extensions are loaded
- Debug mode's local HTTP log ingestion server must be launched on an OS-assigned port (port `0`) to avoid conflicts; the assigned port must be injected into the debug prompt so the agent can generate correct `fetch` instrumentation
- `ask_user` is a shipped prerequisite for Debug mode and should be bundled by default; fallback behavior is only for compatibility when a host or client cannot surface the tool's UI flow

## Goals / Non-Goals

**Goals:**
- `/ask` toggle that enforces read-only semantics via dual-layer defense (prompt override + guaranteed execution-time guard)
- `/debug` toggle that elevates reasoning (resolved slow model, thinking `high`), injects the verbatim Cursor Debug mode prompt from `docs/cursor-prompt-reference.md` via session-scoped context, and manages a local NDJSON log ingestion server
- Reproduce/confirm loop driven by bundled `ask_user`, with RPC/host fallback only when the UI path is unavailable
- Status bar segments for both modes
- RPC protocol surface: `set_ask_mode`, `set_debug_mode` commands and `mode` field on `RpcSessionState`
- Shared session-level mode helpers that can be invoked from both interactive and RPC code paths

**Non-Goals:**
- Ask mode does not modify model or thinking level
- Print mode (`-p`) does not need mode enforcement
- Debug mode does not restrict the tool set — write access is intentionally preserved
- Modes do not need to stack with each other or with `/plan` in v1; entering one mode while another is active should disable the previous one
- The log ingestion server is per-session, not shared across sessions
- No UI mode selector beyond the slash command

## Decisions

### D1: Ask mode enforcement must be guaranteed in core execution, not depend on optional extensions

Ask mode needs to prevent writes without removing tools from the active set, so the model can still attempt a call and receive a meaningful refusal rather than hallucinating an absent tool. The existing `tool_call` semantics in `packages/coding-agent/src/extensibility/extensions/wrapper.ts` are useful, but they are only available when an `ExtensionRunner` exists. Therefore the design SHALL introduce a core Ask-mode execution guard that is always active for tool execution, and MAY additionally reuse the `tool_call` hook path when an extension runner is present.

**Alternative considered**: calling `session.setActiveToolsByName(readOnlySubset)` on mode entry and restoring on exit. Rejected because it requires maintaining a tool-list snapshot across toggle cycles, silently drops dynamically registered tools, and changes model behavior from "tool exists but is denied" to "tool disappeared."

### D2: Mode state structs and session helpers modeled after `PlanModeState`

Each mode gets a typed state struct (for example `AskModeState { enabled: boolean }` and `DebugModeState { enabled: boolean, sessionId: string, logPath: string, ingestUrl: string, previousModel: string, previousThinkingLevel: string, server: Server }`). State lives on the agent session object, exposed via `getAskModeState()` / `getDebugModeState()` analogous to `getPlanModeState()`.

Because RPC does not have access to `InteractiveModeContext`, mode transitions should be implemented through shared session-level helpers that both interactive mode and RPC mode can call, rather than duplicating toggle logic in two places.

**Alternative considered**: storing mode state as ad-hoc flags on `InteractiveModeContext`. Rejected because the struct pattern is already established and makes status bar segments and prompt injection logic straightforward to co-locate with the state.

### D3: Log ingestion server — HTTP for JS/TS, direct NDJSON for all other languages

Following Cursor's split: JavaScript and TypeScript instrumentation uses `fetch` POST to `http://127.0.0.1:<port>/ingest/<sessionId>` (the server serializes concurrent writes and works across process boundaries). All other languages append NDJSON directly to `.pi/debug-<sessionId>.log` using standard file I/O.

Server implemented with `Bun.listen` on port 0 (OS assigns the port). The assigned port and log path are written into the debug mode system prompt injection so the agent has them when generating instrumentation code.

**Alternative considered**: NDJSON direct-append only (no HTTP server). Rejected because concurrent async JS/TS instrumentation points can interleave or be lost on process crash; the HTTP path serializes writes and handles remote execution contexts.

### D4: `ask_user` is a bundled Debug dependency; fallback only covers incompatible hosts/clients

The agent calls the shipped `ask_user` tool with reproduction steps as the `question`, hypothesis summary as `context`, and two options: `"Proceed"` (logs captured, still broken) and `"Mark as fixed"` (issue resolved). This is the primary Debug UX and should be treated as a prerequisite of the feature, not an optional add-on.

**Fallback**: if the host or RPC client cannot surface the `ask_user` UI flow, the agent falls back to emitting `extension_ui_request { method: "confirm" }` and resuming on `extension_ui_response`.

**Alternative considered**: Cursor's `<reproduction_steps>` XML tag approach. Rejected because it requires the host UI layer to detect the tag and inject a follow-up, which is not wired in omp's host.

### D5: Ask/Debug prompt content is sourced verbatim, but injected via session custom messages

`docs/cursor-prompt-reference.md` captures the exact prompt blocks Cursor injects for Ask and Debug mode and is the canonical source for the injection text. Ask and Debug should follow the same integration pattern as `/plan`: build a session-scoped custom message in `AgentSession` and prepend it to turns while the mode is active. This keeps mode behavior aligned with the existing session lifecycle, including compaction and context assembly.

The Debug mode prompt injection SHALL use the captured text verbatim, adapting only session-specific values (port, log path, session ID) at activation time.

`packages/coding-agent/src/prompts/agents/oracle.md` is a useful structural reference because oracle uses the same slow-model slot and thinking level `high`, and its output framing mirrors the debug workflow. However, `/debug` is **not** implemented as an oracle sub-agent spawn — oracle is read-only and blocks on completion, whereas Debug mode is interactive and write-capable.

### D6: Named modes are mutually exclusive, including `/plan`

If the user runs `/debug` while Ask mode or Plan mode is active, the previous mode is disabled first. The same rule applies for `/ask`. This avoids conflicting constraints (read-only vs. write-capable), keeps status-line state unambiguous, and matches the current user mental model of a single active named posture.

### D7: RPC protocol changes include client support, not just server types

Adding `set_ask_mode`, `set_debug_mode`, and `RpcSessionState.mode` on the server side is not sufficient for an end-to-end RPC story. The plan must also account for any RPC client surface that currently ignores `extension_ui_request`, so confirm/fallback flows can be consumed by embedders without custom stdout parsing.

## Risks / Trade-offs

- **Guaranteed Ask guard requires a new core integration point** → more invasive than a wrapper-only solution, but necessary to satisfy the read-only guarantee in sessions without extensions
- **Port collision on `Bun.listen(0)` failure** → extremely unlikely, but if the OS cannot allocate a port the debug session must fall back to direct NDJSON append for all languages. Mitigation: wrap the server start in a try/catch; log the failure and continue in file-append-only mode.
- **Log file path on Windows** → `.pi/debug-<sessionId>.log` uses forward slashes; path construction must use `path.join`. Low risk given the current platform target but worth noting.
- **Prompt/context size** → each mode injects a session-scoped context block; stacking modes was ruled out, but even a single debug injection with the full verbatim Cursor prompt adds ~1–2 KB. Acceptable for a session-scoped toggle.
- **Thinking level restore** → if the user manually changes the model mid-debug session and then exits debug mode, restoring the "previous" model requires snapshotting it on mode entry. The state struct (`DebugModeState`) should capture `previousModel` and `previousThinkingLevel` at enable time.
- **RPC embedder compatibility** → server-side support for `extension_ui_request` already exists, but some clients may ignore those messages. Mitigation: update the RPC client surface or document the requirement clearly.

## Open Questions

- Should `/ask` and `/debug` use explicit `enable/disable` session helpers internally, with slash commands remaining a thin toggle wrapper? This is the cleanest fit for both interactive and RPC entry points.
- Should the Ask guard also explicitly constrain sub-agent/task execution so delegated agents inherit the parent session's read-only posture?
- What is the right timeout for the `ask_user` reproduce prompt, and what should Debug mode do on timeout?
