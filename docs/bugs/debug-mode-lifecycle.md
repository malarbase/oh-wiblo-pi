# Debug Mode — Lifecycle

## Overview

Debug mode makes the agent debug with runtime evidence: while the mode is
active, a local log-ingestion server is up and the system prompt carries a
debug directive with the live endpoint, log path, and session id baked in.

The directive rides the rebuilt system prompt
(`AgentSession.getModeContextPrompt()`, consumed by `rebuildSystemPrompt` in
`sdk.ts`), never the transcript — so leaving the mode rebuilds the prompt
without it and no stale endpoint survives in history.

## Activation

Every entry point funnels through `InteractiveMode.#setActiveMode("debug")`
(`packages/coding-agent/src/modes/interactive-mode.ts`):

- `/debug` (inline spec in `slash-commands/builtin-registry.ts`)
- the `switch_mode` tool (`handleSwitchModeTool`)
- the mode cycler (`cycleAgentMode`: ask → debug)

`#setActiveMode("debug")`:

1. Exits the previous mode first (a debug → debug re-entry is short-circuited
   before this point: `#setActiveMode` no-ops when the target equals the
   current mode, and `handleDebugModeCommand` reports "already active").
2. `await session.enableDebugMode()` (`packages/coding-agent/src/session/agent-session.ts`):
   1. allocates `#debugModeState` (`DebugModeState`,
      `packages/coding-agent/src/modes/debug-mode/state.ts`) with the session id
      (`sessionManager.getSessionId()`), `logPath = <session cwd>/.pi/debug-<sessionId>.log`,
      and an initially empty `ingestUrl`;
   2. `startLogServer(sessionId, logPath)`
      (`packages/coding-agent/src/modes/debug-mode/log-server.ts`) binds a Bun
      HTTP server on `127.0.0.1:0` (OS-assigned port), accepting
      `POST /ingest/<sessionId>` and appending the body as an NDJSON line to
      the log path (directory created on demand);
   3. fills the real `ingestUrl` (`http://127.0.0.1:<port>/ingest/<sessionId>`)
      and the live `server` handle into the state. A bind failure is logged
      (`logger.error`) rather than thrown — `#setActiveMode` has already
      committed the mode at that point, so debug mode activates with an empty
      endpoint instead of leaving a half-switched mode behind.
3. Sets the status-line badge (`statusLine.setDebugModeStatus({ enabled: true })`)
   and records the transition (`sessionManager.appendModeChange("debug")`).
4. `await session.refreshBaseSystemPrompt()` — `sdk.ts#rebuildSystemPrompt`
   appends `session.getModeContextPrompt()`, which for active debug mode
   renders `prompts/system/debug-mode-context.md` with `{{ingestUrl}}`,
   `{{logPath}}`, and `{{sessionId}}` substituted. The agent now has the live
   endpoint baked into its context.

## Deactivation

Leaving debug mode (`/agent`, `cycleAgentMode`, `switch_mode`) runs the exit
arm of `#setActiveMode`:

1. `await session.disableDebugMode()` — stops the log server
   (`server.stop()`), so the endpoint dies with the mode, then clears
   `#debugModeState`.
2. The status badge is cleared (`statusLine.setDebugModeStatus(undefined)`).
3. The prompt rebuild at the end of `#setActiveMode` no longer finds debug
   state, so `getModeContextPrompt()` returns nothing and the directive is
   gone from the next system prompt.

`AgentSession.dispose()` runs the same teardown (`#stopDebugLogServer`), so a
session disposed while debug mode is active cannot leak the `Bun.serve`
handle and keep the process alive.

## Command surface

- `/debug` — enable debug mode (calls `ctx.handleDebugModeCommand()`). While
  debug mode is active it reports "already active"; leave via `/agent`, the
  mode cycler, or `switch_mode`.
- `/debug tools` — the debug tools selector. Upstream's satellite `/debug`
  spec (in `slash-commands/builtin-lifecycle.ts`) is filtered out of the
  registry composition in `builtin-registry.ts` so the fork's mode toggle owns
  the name; the selector capability stays reachable as this subcommand and via
  the global debug keybinding (`ui.onDebug`).

## Log format

Logs are NDJSON — one JSON object per line — written to
`<session cwd>/.pi/debug-<sessionId>.log`. The prompt's instrumentation
template POSTs payloads (`{sessionId, runId, hypothesisId, location, message,
data, timestamp}`) to the ingest endpoint; for non-JavaScript languages the
directive has the model append NDJSON lines to the log path directly.

## Notes

- There is no debug-mode "off" message: `prompts/system/debug-mode-off.md`
  exists on disk but is not wired into any code path. Deactivation relies on
  the wholesale prompt rebuild, which both removes the directive and
  invalidates the endpoint (the directive never enters the transcript, so the
  model cannot retrieve a dead endpoint from history).
