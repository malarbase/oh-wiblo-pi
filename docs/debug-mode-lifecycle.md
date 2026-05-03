# Debug Mode — Lifecycle and Known Issues

## Lifecycle

### Activation

`InteractiveMode.#enterDebugModeInternal()` (`packages/coding-agent/src/modes/interactive-mode.ts:1164`)

1. `session.enableDebugMode()` — allocates `#debugModeState` with the session ID and log path; `ingestUrl` starts as `""`.
2. `startLogServer(sessionId, logPath)` (`packages/coding-agent/src/modes/debug-mode/log-server.ts:16`) — binds a Bun HTTP server on `127.0.0.1:0` (OS-assigned port). Accepts `POST /ingest/<sessionId>`, appends body as NDJSON to the log file.
3. `debugState.ingestUrl` is updated to the real `http://127.0.0.1:<port>/ingest/<sessionId>`.
4. `session.sendDebugModeContext()` — renders `prompts/system/debug-mode-context.md` with `{{ingestUrl}}`, `{{logPath}}`, `{{sessionId}}` substituted and injects it into the conversation as a non-displayed custom message. The agent now has the live endpoint baked into its context.

### Deactivation

`InteractiveMode.#exitDebugModeInternal()` (`interactive-mode.ts:1150`)

1. `state.server.stop()` — **log server is killed here**.
2. `session.disableDebugMode()` (`agent-session.ts:2520`) — clears `#debugModeState`, then sends `prompts/system/debug-mode-off.md` as a custom message.

The off message (`debug-mode-off.md`) currently reads:

> Debug mode has been disabled. You are back in normal agent mode. Extended thinking and the debug-focused diagnostic posture no longer apply. Proceed as normal.

---

## Bug 1 — Off message does not invalidate the stale endpoint

### What happens

The live `ingestUrl` (e.g. `http://127.0.0.1:64795/ingest/<id>`) is baked into the agent's conversation history by `sendDebugModeContext()`. When `#exitDebugModeInternal()` runs, it stops the server **before** sending the off message. The off message does not mention the endpoint.

If the agent later encounters a debugging task, it can retrieve that endpoint from earlier in the context window and attempt to use it. Every `fetch()` to a dead server returns connection refused (exit 7). The log file is never created. The agent interprets the missing file as a missing tool-call output and either halts or proceeds without evidence.

### Root cause

`disableDebugMode()` in `agent-session.ts:2520` clears `#debugModeState = undefined` before constructing the off message, discarding the `ingestUrl`. The off prompt is a static string with no template variables, so it cannot reference the now-dead endpoint.

### Fix

**Option A — minimum (static warning):** Strengthen `debug-mode-off.md` to say the endpoint is dead without naming it:

```
Debug mode has been disabled. You are back in normal agent mode.

The log server provisioned for this session has been stopped. Any
`ingestUrl` or endpoint referenced in earlier messages in this conversation
is no longer reachable. Do NOT attempt to use it. Do NOT add fetch()-based
instrumentation of any kind.
```

**Option B — name the dead endpoint explicitly:** Capture `state.ingestUrl` before clearing state, render the off message as a template.

In `agent-session.ts:disableDebugMode()`:
```ts
async disableDebugMode(): Promise<void> {
    const state = this.#debugModeState;
    if (!state?.enabled) return;
    const ingestUrl = state.ingestUrl;   // capture before clearing
    this.#debugModeState = undefined;
    await this.sendCustomMessage({
        customType: "debug-mode-off",
        content: prompt.render(debugModeOffPrompt, { ingestUrl }),
        display: false,
    });
}
```

Add `{{ingestUrl}}` to `debug-mode-off.md`:
```
The log server at `{{ingestUrl}}` has been stopped and is no longer
reachable. Do not attempt fetch() calls to this endpoint.
```

---

## Bug 2 — Agent self-activates debug workflow from topic, not from session state

### What happens

The off message says "Extended thinking and the debug-focused diagnostic posture no longer apply." However, it does not explicitly prohibit the agent from entering the debug workflow (hypothesis list → instrumentation → reproduction ask → log analysis) when the *topic* of the conversation is debugging. The agent interprets "debugging" as a trigger for the debug workflow rather than treating it as a harness-controlled mode that requires an active in-turn activation message.

Observed behaviour: user asked "how do I debug this?" after debug mode had been disabled. Agent generated 5 hypotheses, added `fetch()`-based instrumentation using the stale endpoint, and asked the user to reproduce — the full debug mode workflow, without any active debug session.

### Root cause

The off message lacks an explicit constraint on when the debug workflow is permitted.

### Fix

Add to `debug-mode-off.md`:

```
You will only enter the debug-mode workflow (hypotheses, fetch()
instrumentation, reproduction steps, log analysis) when an explicit
debug mode activation message is delivered to you in the CURRENT turn.
Never self-activate this workflow because the topic involves debugging.
Standard investigation applies: read code, identify cause, fix.
```

---

## Summary of files to change

| File | Change |
|------|--------|
| `packages/coding-agent/src/prompts/system/debug-mode-off.md` | Add endpoint-invalidation and self-activation prohibition (see both fixes above) |
| `packages/coding-agent/src/session/agent-session.ts:2520` | Capture `state.ingestUrl` before clearing; render off prompt as template (Bug 1 Option B) |
