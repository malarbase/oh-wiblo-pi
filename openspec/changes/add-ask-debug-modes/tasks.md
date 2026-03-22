## 1. Shared Mode Infrastructure

- [ ] 1.1 Add `AskModeState { enabled: boolean }` to `packages/coding-agent/src/modes/ask-mode/state.ts`, modeled after `packages/coding-agent/src/plan-mode/state.ts`
- [ ] 1.2 Add `DebugModeState { enabled: boolean, sessionId: string, logPath: string, ingestUrl: string, previousModel: string, previousThinkingLevel: string, server: unknown }` to `packages/coding-agent/src/modes/debug-mode/state.ts`
- [ ] 1.3 Expose `getAskModeState()` / `setAskModeState()` and `getDebugModeState()` / `setDebugModeState()` on `packages/coding-agent/src/session/agent-session.ts`, following the existing plan-mode pattern
- [ ] 1.4 Add shared session-level enable/disable helpers for Ask and Debug mode so both interactive mode and RPC mode can reuse the same transition logic

## 2. Ask Mode — Slash Command and State

- [ ] 2.1 Add `/ask` entry to `packages/coding-agent/src/slash-commands/builtin-registry.ts` with a `handle` that calls `runtime.ctx.handleAskModeCommand()`
- [ ] 2.2 Add `handleAskModeCommand()` to `packages/coding-agent/src/modes/types.ts`
- [ ] 2.3 Implement `handleAskModeCommand()` in `packages/coding-agent/src/modes/interactive-mode.ts` as a thin toggle wrapper over the shared session helpers; if enabling and another named mode is active, disable it first

## 3. Ask Mode — Read-Only Enforcement

- [ ] 3.1 Define the `READ_ONLY_TOOLS` allowlist (read-file/search/list/diagnostics equivalents plus other safe inspection tools) under `packages/coding-agent/src/modes/ask-mode/`
- [ ] 3.2 Implement a guaranteed Ask-mode execution guard in core tool execution that blocks non-readonly tools even when no `ExtensionRunner` is present
- [ ] 3.3 Reuse `tool_call` hook semantics when an `ExtensionRunner` exists so the blocked-tool experience is consistent across extension and non-extension sessions
- [ ] 3.4 Add coverage for delegated/sub-agent execution so Ask mode cannot be bypassed through task/sub-agent spawning
- [ ] 3.5 Write the Ask mode prompt block and inject/remove it via `AgentSession` custom messages, mirroring the existing plan-mode context pattern rather than only mutating `system-prompt.ts`

## 4. Ask Mode — Status Bar

- [ ] 4.1 Add an Ask mode status segment to `packages/coding-agent/src/modes/components/status-line/segments.ts` following the `plan` segment pattern; plumb the corresponding context through the status-line types/state

## 5. Debug Mode — Slash Command and Session Elevation

- [ ] 5.1 Add `/debug` entry to `packages/coding-agent/src/slash-commands/builtin-registry.ts` with a `handle` that calls `runtime.ctx.handleDebugModeCommand()`
- [ ] 5.2 Add `handleDebugModeCommand()` to `InteractiveModeContext` and implement it in `packages/coding-agent/src/modes/interactive-mode.ts` as a thin toggle wrapper over the shared session helpers
- [ ] 5.3 On enable, snapshot current model and thinking level into `DebugModeState`; switch to the slow model resolved by `packages/coding-agent/src/config/model-resolver.ts`; set thinking level to `high`; on disable, restore the snapshotted values

## 6. Debug Mode — Log Ingestion Server

- [ ] 6.1 Implement the local HTTP log ingestion server module (for example `packages/coding-agent/src/modes/debug-mode/log-server.ts`): start with `Bun.listen` on port `0`, accept POST `/ingest/<sessionId>`, append each request body as an NDJSON line to `.pi/debug-<sessionId>.log`, return 200, and expose `start()` / `stop()`
- [ ] 6.2 Start the log server on debug mode activation; store `port`, `logPath`, `ingestUrl`, and `server` in `DebugModeState`; stop and clean up on deactivation
- [ ] 6.3 Add a try/catch around server start; if port allocation fails, log the error and fall back to direct-append-only mode for all languages

## 7. Debug Mode — System Prompt and Diagnostic Framing

- [ ] 7.1 Build Ask and Debug prompt/context messages from the verbatim Cursor prompt blocks captured in `docs/cursor-prompt-reference.md`; substitute only session-specific values (port, log path, session ID)
- [ ] 7.2 Inject/remove the Debug mode context via `packages/coding-agent/src/session/agent-session.ts`, mirroring how `plan-mode-context` is prepended to turns
- [ ] 7.3 Make mode transitions mutually exclusive with `/plan` so enabling Ask or Debug disables any existing named mode first

## 8. Debug Mode — Status Bar

- [ ] 8.1 Add a Debug mode status segment to `packages/coding-agent/src/modes/components/status-line/segments.ts`; plumb the corresponding context through the status-line types/state

## 9. RPC Protocol Surface

- [ ] 9.1 Add `{ id?: string; type: "set_ask_mode"; enabled: boolean }` to `packages/coding-agent/src/modes/rpc/rpc-types.ts`
- [ ] 9.2 Add the corresponding `set_ask_mode` success response to `RpcResponse`
- [ ] 9.3 Add `{ id?: string; type: "set_debug_mode"; enabled: boolean }` to `RpcCommand` and its corresponding success response to `RpcResponse`
- [ ] 9.4 Add `mode?: "ask" | "debug"` to `RpcSessionState`
- [ ] 9.5 Wire `set_ask_mode` and `set_debug_mode` command handlers in `packages/coding-agent/src/modes/rpc/rpc-mode.ts` to the shared session helpers, not to interactive-only methods
- [ ] 9.6 Update any relevant RPC client surface (likely `packages/coding-agent/src/modes/rpc/rpc-client.ts`) so `extension_ui_request` confirm flows used by Debug mode are consumable without custom stdout parsing

## 10. Debug Mode — ask_user Integration and RPC Fallback

- [ ] 10.1 Bundle `ask_user` by default as a prerequisite of Debug mode; document that Debug mode depends on it for its primary reproduce/confirm UX
- [ ] 10.2 Add a startup/runtime assertion so Debug mode surfaces a clear error if `ask_user` is unexpectedly unavailable in builds that claim to support the feature
- [ ] 10.3 Wire the RPC/host fallback path for environments that cannot surface `ask_user`: the agent prompt section should instruct it to emit `extension_ui_request { method: "confirm" }`, and the host/client should resume on `extension_ui_response`
