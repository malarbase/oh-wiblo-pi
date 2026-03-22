## Why

omp operates in a single posture today — full agentic mode with write access enabled at all times. Users have no way to signal *exploration* versus *implementation* intent, which means a poorly worded question can trigger unintended edits and a debugging session degenerates into guess-and-apply cycles that burn context and leave the codebase in an indeterminate state. Adding Ask and Debug as named, slash-command-toggled modes gives users the same intentional context-switching that Cursor's mode selector provides, without leaving the tool.

## What Changes

- Add `/ask` slash command that enters a read-only, conversational posture for codebase Q&A — write tools remain registered but are rejected by a guaranteed execution-time guard even when no extensions are loaded; the session is also steered with a hard read-only prompt override
- Add `/debug` slash command that enters a hypothesis-driven, evidence-first debugging posture — elevates thinking level to `high` and switches to the resolved slow model; injects a diagnostic prompt section using the same session-message pattern as `/plan`; starts a local HTTP log ingestion server for structured NDJSON traces; bundles `ask_user` by default for the reproduce/confirm loop
- Expose both modes over the RPC protocol — `set_ask_mode` and `set_debug_mode` command types added to `RpcCommand`, and a `mode` field added to `RpcSessionState`
- Add status bar segments for both modes following the existing `plan` segment pattern

## Principles Alignment

This proposal preserves the concrete implementation plan above. It does not change the intended behavior, scope, or delivery model of Ask and Debug mode.

Within `omp`, the change is aligned with the existing product direction of shipping opinionated built-in workflows such as `/plan` and `oracle`, rather than leaving all higher-level interaction postures to optional packages. The implementation also reuses pi's extensibility patterns where practical: slash-command entrypoints, session-scoped custom context injection, extension-style tool blocking semantics, and RPC confirm/UI fallbacks.

Relative to upstream `pi`'s minimal-core philosophy, this proposal is an intentional divergence in a narrow area. In particular, Ask mode's guaranteed execution-time guard must live in core so read-only behavior still holds when no optional extensions are loaded, and Ask/Debug are shipped as first-class built-in modes rather than third-party extensions or packages.

## Capabilities

### New Capabilities

- `ask-mode`: `/ask` slash command that toggles a read-only session posture; enforces the constraint via dual-layer defense (session prompt override + guaranteed execution-time tool blocking that does not depend on optional extensions); declines write requests and redirects the user to Agent mode
- `debug-mode`: `/debug` slash command that elevates the session to extended-thinking reasoning (resolved slow model, thinking level `high`), injects the verbatim Cursor Debug mode prompt from `docs/cursor-prompt-reference.md` via session-scoped custom context, starts a local HTTP NDJSON log ingestion server, and gates the fix loop on runtime evidence via bundled `ask_user` reproduce/confirm calls
- `rpc-ask-debug`: RPC protocol surface for both modes — `set_ask_mode` / `set_debug_mode` commands, `mode` field in `RpcSessionState`, and a confirm fallback for clients that do not surface `ask_user` / extension UI

### Modified Capabilities

_(none — this change introduces new surface only)_

## Impact

- **`packages/coding-agent/src/slash-commands/builtin-registry.ts`** — two new entries (`/ask`, `/debug`)
- **`packages/coding-agent/src/modes/types.ts`**, **`packages/coding-agent/src/modes/interactive-mode.ts`**, and **`packages/coding-agent/src/session/agent-session.ts`** — shared Ask/Debug mode helpers plus session state structs modeled after `PlanModeState`
- **`packages/coding-agent/src/extensibility/extensions/wrapper.ts`** and/or a core tool-execution guard — Ask mode write blocking integrated where it is always enforced, with extension-hook reuse when available
- **`packages/coding-agent/src/session/agent-session.ts`** — Ask and Debug prompt/context messages injected and removed using the same custom-message pattern as plan mode
- **`packages/coding-agent/src/modes/components/status-line/segments.ts`** — two new status bar segments
- **`packages/coding-agent/src/modes/rpc/rpc-types.ts`**, **`packages/coding-agent/src/modes/rpc/rpc-mode.ts`**, and likely **`packages/coding-agent/src/modes/rpc/rpc-client.ts`** — `set_ask_mode` / `set_debug_mode`, `RpcSessionState.mode`, and confirm-flow client handling
- **New module** — local HTTP log ingestion server (`Bun.listen` on port 0; writes NDJSON to `.pi/debug-<sessionId>.log`); shut down on `/debug` toggle off
- **Dependencies** — bundle `ask_user` by default as part of Debug mode's shipped reproduce/confirm UX
