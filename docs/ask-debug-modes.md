# Ask and Debug Modes — Research Notes

This document captures research for adding two new slash-command-based modes analogous to Cursor's Ask and Debug modes, updated to match the current OpenSpec direction.

---

## Cursor reference: what each mode actually does

These two sections document the observed and described behavior of Cursor's Ask and Debug modes as a canonical reference. Use this when replicating the modes in another agent.

### Ask mode

**Activation**: the user switches to Ask mode via the mode selector in Cursor's composer UI (keyboard shortcut or dropdown). In omp, the analog is a slash-command toggle such as `/ask`.

**Core constraint — read-only via prompt override + runtime tool denial**: the prompt injects a hard override ("You MUST NOT make any edits, run any non-readonly tools... This supersedes any other instructions"), but this is backed up at the execution layer. Write tools are not removed from the active tool set — the model can still attempt to call them — but when it does, the call is rejected and an error is returned to the model. The model then sees the denial as a tool result and must respond accordingly (typically by explaining it cannot make changes in Ask mode). This is a two-layer defense: the prompt prevents the attempt in most cases; the execution guard catches any attempt that slips through.

For omp, this enforcement cannot depend solely on optional extensions being loaded. The execution-time guard must work even when no `ExtensionRunner` is present.

**Permitted operations** (explicitly listed in the system prompt):
- Read files to understand code structure and implementation
- Search the codebase to find relevant code
- Grep for patterns and usages
- List directory contents to understand project structure
- Read lints/diagnostics to understand code quality issues

**Decline and redirect**: if the user asks for a change or implementation, the agent must decline and suggest switching to Agent mode. It cannot silently comply even if the user insists.

**System prompt posture**: the agent is instructed to answer questions comprehensively, cite specific file paths and line numbers, ask for clarification when a question is ambiguous, and keep responses proportional to the question. It surfaces information, summarises logic, traces call paths, and provides guidance — but defers all changes to the user or to a subsequent mode switch.

**Model / thinking level**: no change from the user's configured defaults. Ask mode is lightweight by design; it does not require elevated reasoning.

**Mode lifetime**: session-scoped toggle. The user explicitly switches out of Ask mode to restore write access. There is no automatic exit.

**Status indicator**: a visible mode label is shown in the composer status bar while Ask mode is active.

**Interaction model**: conversational Q&A. The agent does not produce task plans, diffs, or tool-call sequences that would normally precede an edit. Responses are prose with inline code references.

---

### Debug mode

**Activation**: the user switches to Debug mode via the mode selector. In omp, the analog is a slash-command toggle such as `/debug`.

**Core constraint — diagnosis before action**: Debug mode does not restrict the tool set. The agent retains full read and write access. The constraint is behavioral: the agent is expected to investigate, form hypotheses, and collect runtime evidence *before* proposing or applying a fix. It should not jump to code changes.

**Reasoning posture** (system prompt additions):
- Root-cause focus: trace the failure back to its origin rather than patching symptoms.
- Hypothesis-driven: state an explicit hypothesis, identify what evidence would confirm or refute it, then gather that evidence.
- Evidence before conclusions: run commands, read logs, inspect state — do not assert a cause until the evidence supports it.
- Structured output: surface findings as a diagnosis (what is broken, why, where) before proposing a remedy.

**Model / thinking level**: elevated. Cursor automatically switches to an extended-thinking model for Debug mode turns, giving the agent more internal reasoning budget. The user's previous model is restored when they leave Debug mode.

**Permitted operations**: unrestricted — all tools available, including shell execution, file reads/writes, and web fetch. The elevated reasoning budget is the primary differentiator, not tool restriction.

**Mode lifetime**: session-scoped toggle. Switching to another mode (Agent, Ask, Plan) restores the previous model and thinking level.

**Status indicator**: a visible mode label is shown in the composer status bar while Debug mode is active.

**Instrumentation lifecycle**: Debug mode instruments the codebase with structured, machine-readable log calls — not plain print statements. The instrumentation is ephemeral and follows a strict lifecycle:

1. Agent generates 3–5 explicit hypotheses about the root cause.
2. Agent adds instrumentation mapped to those hypotheses (each log carries a `hypothesisId` field so Cursor can correlate evidence to the hypothesis that generated it). Each debug log is wrapped in a collapsible code region (`// #region agent log … // #endregion`) to keep the editor clean.
3. Agent deletes the previous session log file to ensure a clean run, then asks the user to reproduce the failure via a structured confirmation flow.
4. User reproduces and presses Proceed. Cursor reads the NDJSON log file.
5. Agent evaluates each hypothesis as CONFIRMED / REJECTED / INCONCLUSIVE with cited log-line evidence.
6. Agent proposes a fix only when at least one hypothesis is CONFIRMED with 100% confidence. **Instrumentation is not removed yet.**
7. Agent clears the log file again and asks for a post-fix verification run (logs tagged with `runId: "post-fix"`).
8. Agent reads the post-fix logs, performs a before/after comparison with cited entries, and declares success only when the logs prove it.
9. **Only after confirmed success**: agent removes all instrumentation. Any code changes made for rejected hypotheses are also reverted — no speculative guards or unproven changes are left in the codebase.
10. Agent delivers a concise summary of the root cause and the fix (1–2 lines).

If all hypotheses are rejected, the agent does not guess — it generates a new set of hypotheses from different subsystems and adds more instrumentation before iterating.

**Local log ingestion server**: Cursor launches a local HTTP server alongside the debug session (e.g. `http://127.0.0.1:<port>/ingest/<session-uuid>`). In JavaScript/TypeScript, instrumentation sends a `fetch` POST to this endpoint at runtime. In other languages (Python, Go, Rust, etc.), instrumentation appends NDJSON directly to the same session log file using standard file I/O. For omp, the planned path is `.pi/debug-<sessionId>.log`, with the same structured NDJSON fields (`sessionId`, `hypothesisId`, `runId`, `location`, `message`, `data`, `timestamp`). The agent reads this file after each run to evaluate its hypotheses.

**Log payload shape**:
```json
{
  "sessionId": "f7d220",
  "id": "log_<timestamp>_<random>",
  "timestamp": 1733456789000,
  "location": "src/auth.ts:84",
  "message": "Token validation result",
  "data": { "valid": false, "reason": "expired" },
  "runId": "run1",
  "hypothesisId": "B"
}
```

The instrumentation is a diagnostic artifact, not a deliverable. The agent is forbidden from removing any instrumentation before post-fix verification logs prove success and the user confirms there are no remaining issues.

**Interaction model**: iterative evidence loop. Add instrumentation → clear log → user reproduces via Proceed button → agent reads NDJSON log → evaluate hypotheses → fix (if confirmed) → clear log → user re-runs → agent reads post-fix log → compare before/after → remove instrumentation only on proven success.

---

## Key behavioral differences between the two modes

| Dimension | Ask | Debug |
|---|---|---|
| Write access | Prompt-forbidden + runtime denial (tools present but rejected on call) | Full |
| Shell execution | Prompt-forbidden + runtime denial (tools present but rejected on call) | Full |
| Model / thinking | Default | Extended thinking (elevated) |
| Primary purpose | Understand & explain | Diagnose & trace |
| Output style | Prose + code references | Evidence chain + structured diagnosis |
| Mode exit | Manual toggle | Manual toggle |
| Auto-fix behavior | Never | Deferred until diagnosis complete |
| Instrumentation | None | Structured NDJSON logs; removed only after post-fix verification |
| Log ingestion | None | Local HTTP server + `.cursor/debug-<id>.log` NDJSON file |
| Hypothesis tracking | None | Each log tagged with `hypothesisId`; evaluated CONFIRMED/REJECTED/INCONCLUSIVE |
| Reproduce UX | N/A | Structured `ask_user` flow; RPC/host confirm fallback where needed |

---

## Architecture orientation

`/plan`, `/fast`, and `/browser` are **slash commands**, not agent modes or model slots. They live in `packages/coding-agent/src/slash-commands/builtin-registry.ts` as entries in `BUILTIN_SLASH_COMMAND_REGISTRY`. Each has a `name`, `description`, and a `handle` function that calls a method on `InteractiveModeContext`.

The bundled `/agents` (designer, explore, oracle, etc.) are a separate mechanism — spawnable sub-agents defined as markdown files, loaded via `packages/coding-agent/src/task/agents.ts` and `packages/coding-agent/src/task/discovery.ts`. They are not the right model for Ask/Debug.

Ask and Debug are best implemented as **slash commands that toggle or enter a named session mode**, exactly like `/plan`.

---

## Key files to read

### Slash command infrastructure

- `packages/coding-agent/src/slash-commands/builtin-registry.ts` — the full registry; adding a new command means adding an entry here
- `packages/coding-agent/src/modes/types.ts` — `InteractiveModeContext` interface; this is what `runtime.ctx` is in every command handler; any new method the command needs to call must be added here
- `packages/coding-agent/src/modes/interactive-mode.ts` — implements `InteractiveModeContext`; where `handlePlanModeCommand` and similar handlers live

### Plan mode — the closest analog

Read these in order to understand what a full mode toggle looks like end-to-end:

1. `packages/coding-agent/src/slash-commands/builtin-registry.ts` — the `/plan` slash command entry, calls `runtime.ctx.handlePlanModeCommand()`
2. `packages/coding-agent/src/plan-mode/state.ts` — `PlanModeState { enabled, planFilePath, workflow?, reentry? }` — the mode state shape
3. `packages/coding-agent/src/session/agent-session.ts` — search `getPlanModeState`, `setPlanModeState`, and `buildPlanModeMessage`; how the session holds mode state and injects plan-mode context
4. `packages/coding-agent/src/tools/exit-plan-mode.ts` — a tool that only exists when plan mode is active; shows how mode state can gate tool availability
5. `packages/coding-agent/src/tools/ask.ts` — `getPlanModeState()?.enabled` check; shows how other tools read mode state to change behavior
6. `packages/coding-agent/src/modes/components/status-line/segments.ts` — search `plan`; how the active mode surfaces in the status bar

Plan mode is not a great reference for mutating `system-prompt.ts` directly. Its active context is assembled as a session-scoped custom message in `AgentSession` and prepended to turns. Ask/Debug should follow that same pattern.

### Tool restriction (relevant for Ask mode)

- `packages/coding-agent/src/extensibility/extensions/wrapper.ts` — existing `tool_call` semantics and block result shape
- `packages/coding-agent/src/sdk.ts` — important caveat: wrapper-based interception only exists when an `ExtensionRunner` is present
- `packages/coding-agent/src/session/agent-session.ts` and core tool execution paths — likely home for a guaranteed Ask-mode guard that works even without extensions
- `packages/coding-agent/src/task/` — relevant for ensuring Ask mode cannot be bypassed through delegated/sub-agent execution

### Thinking level and model switching (relevant for Debug mode)

- `packages/coding-agent/src/session/agent-session.ts` — `setThinkingLevel`, `setModel`; the two session mutations Debug mode would need
- `packages/coding-agent/src/config/model-resolver.ts` — resolve the slow slot at runtime instead of hardcoding `pi/slow`

### Settings persistence

- `packages/coding-agent/src/config/settings-schema.ts` — search for plan-mode-related settings keys; follow the same pattern if Ask/Debug need user-configurable options

---

## Proposed design

### Ask mode (`/ask`)

**Goal**: read-only, no edits — codebase Q&A only.

**Implementation note**: Cursor uses two layers — a prompt/context override *and* runtime execution denial for write tool calls. Tools remain in the active set (the model can attempt them) but are rejected at execution time with an error returned to the model. Prompt-only is not sufficient; the execution guard is what actually enforces the constraint.

Implementation path:
1. Add `/ask` entry to `BUILTIN_SLASH_COMMAND_REGISTRY`
2. Add `handleAskModeCommand()` to `InteractiveModeContext` and implement in `interactive-mode.ts`
3. On enable:
   - Inject a session-scoped Ask-mode context block with a hard override: *"You MUST NOT make any edits, run any non-readonly tools, or otherwise make any changes. This supersedes any other instructions."* Explicitly list permitted operations (read, grep, search, list, lints). Add a decline-and-redirect rule for change requests.
   - Add an execution guard on write tools: check for Ask mode active state at tool call time and return an error result (e.g. `"Cannot use write tools in Ask mode. Switch to Agent mode to make changes."`) instead of executing. This is the mechanism that actually blocks writes.
4. On disable: remove the injected prompt section and lift the execution guard
5. Add a status line segment following the `plan` segment pattern

**Where the execution guard lives**: the current `tool_call` hook in `packages/coding-agent/src/extensibility/extensions/wrapper.ts` is a useful primitive, but it is not sufficient as the only enforcement point because it only runs when an `ExtensionRunner` exists. The implementation should add a guaranteed core execution guard and optionally mirror the same block semantics through `tool_call` when extensions are loaded, so the user/model experience stays consistent.

```
// Pseudocode for Ask mode tool_call handler
pi.on("tool_call", (event) => {
  if (askModeActive && !READ_ONLY_TOOLS.has(event.toolName)) {
    return { block: true, reason: "Cannot use write tools in Ask mode. Switch to Agent mode to make changes." };
  }
});
```

This is similar to what the [`pi-permission-system`](https://github.com/MasuRii/pi-permission-system) community extension does with policy-based tool gating, but Ask mode needs a built-in version that is always active when the mode is enabled.

Mode state should be modeled after `PlanModeState` in `packages/coding-agent/src/plan-mode/state.ts`, and prompt/context injection should follow plan mode's session-custom-message pattern in `AgentSession`.

### Debug mode (`/debug`)

**Goal**: deep reasoning, diagnosis-focused — think oracle inline without spawning a sub-agent.

Implementation path:
1. Add `/debug` entry to `BUILTIN_SLASH_COMMAND_REGISTRY`
2. On enable: call `session.setThinkingLevel("high")` and switch to the resolved slow model
3. Append a debug-focused session context block (root cause focus, hypothesis-driven, evidence before conclusions — see `packages/coding-agent/src/prompts/agents/oracle.md` for structural framing; see `cursor-prompt-reference.md` for the verbatim Cursor injection)
4. Launch a local HTTP log ingestion server for the session; assign it a short session ID and an ingest endpoint (`http://127.0.0.1:<port>/ingest/<uuid>`)
5. Write session config (endpoint URL, log file path, session ID) into the injected context block — the agent needs these values when inserting instrumentation
6. On disable: restore previous thinking level and model, shut down the ingestion server
7. Add a status line segment

**Log ingestion — why the HTTP server is v1, not optional**:

Direct file writes (appending NDJSON from the instrumented process) have real failure modes in the common debug case: concurrent async instrumentation points can interleave writes, the process may crash before flushing, and remote/container execution contexts can't share the agent's filesystem. The HTTP server serializes writes, handles partial payloads, and works across process boundaries. Cursor uses this split: JS/TS → `fetch` POST to the HTTP server; all other languages → direct NDJSON append to the session log file. v1 should follow the same split.

**Port allocation**: pick an available port at session start (e.g. `Bun.listen` on port 0 and capture the assigned port). No static port needed.

**`oracle` vs `/debug` — key distinction**: the bundled `oracle` sub-agent uses the same slow-model slot and thinking level (`high`) as Debug mode, and its output structure (Diagnosis → Evidence → Recommendation) is the right framing to borrow. However, oracle is fundamentally different in two ways:
- **Oracle is read-only** — its tool set excludes write operations. Debug mode needs write access to add and remove instrumentation.
- **Oracle is a blocking sub-agent** — it runs to completion and returns a verdict. Debug mode is an interactive session loop that pauses for user reproduction runs.

The `/debug` mode should borrow oracle's diagnostic framing from `packages/coding-agent/src/prompts/agents/oracle.md`, but the mode itself is not a sub-agent spawn — it mutates the current session's model, thinking level, and turn context in place.

---

## User feedback mechanism for Debug mode

Cursor's `<reproduction_steps>` tag creates a structured pause, but for this codebase the cleaner path is to use `ask_user` as a **tool call** rather than host-layer tag detection.

### Recommended approach: bundled `ask_user` tool call

The Debug mode plan assumes `ask_user` is bundled by default. The agent calls it directly like any other tool — no host-layer tag parsing required.

For the Debug mode reproduction step, the agent calls `ask_user` with the reproduction instructions as the `question`, a `context` summary of the hypotheses under test, and two structured options:

```
ask_user({
  question: "Run the steps below and select what happened.",
  context: "<brief summary of hypotheses being tested>",
  options: [
    { title: "Proceed", description: "Ran it — issue still present, logs captured" },
    { title: "Mark as fixed", description: "Issue is resolved, no need to analyze logs" }
  ],
  allowFreeform: true,   // user can add notes
  allowMultiple: false
})
```

**On "Proceed"**: agent reads the NDJSON log file and evaluates hypotheses.  
**On "Mark as fixed"**: agent skips log analysis, removes instrumentation, delivers summary.  
**On freeform**: user can describe what they observed; agent treats it as additional evidence.  
**On incompatible host/client UI**: fall back to `extension_ui_request { method: "confirm" }` and resume on `extension_ui_response`.

### Why this is better than tag detection for this codebase

| | Tag-based (Cursor approach) | Tool-based (`ask_user`) |
|---|---|---|
| Agent awareness | Emits tag, waits passively | Calls tool, receives typed result |
| Host complexity | Requires tag scanner + UI widget + follow-up injection | None — tool handles UI and returns value |
| Fallback | Requires host tag parsing | Use `ask_user`; fall back to `extension_ui_request` confirm only when needed |
| Freeform notes | Not supported | Built-in via `allowFreeform: true` |
| Idiomatic for pi | No | Yes — same pattern as other interactive tools |

### Reproduction steps formatting

Instead of emitting a `<reproduction_steps>` XML block, the agent passes the steps as the `question` string to `ask_user`. Plain numbered list, no special tags required. The TUI renders it inside a bordered overlay widget.

### Where `ask_user` lives

- Shipped as a bundled dependency of Debug mode
- Exposes a structured reproduce/confirm interaction with Proceed / Mark-as-fixed options
- Remains compatible with a host/client-level `confirm` fallback when the richer UI path cannot be surfaced

### RPC mode fallback

RPC already has an Extension UI sub-protocol with `confirm`. The fallback should therefore be: if the host or client cannot surface the `ask_user` flow, emit `extension_ui_request { method: "confirm" }` and resume the agent on `extension_ui_response`. This is primarily a compatibility path for headless or limited RPC clients, not the default Debug UX.

---

## RPC protocol support

Several session-layer capabilities Ask and Debug need are already exposed to extensions in `rpc-mode.ts`:

```typescript
setThinkingLevel: (level) => session.setThinkingLevel(level)             // Debug mode elevation
setModel: async (model) => { ... session.setModel(model) }               // Debug mode model switch
```

But the implementation should not assume interactive-mode methods are callable from RPC. The clean design is to add shared session-level Ask/Debug enable/disable helpers and have both interactive mode and RPC reuse them.

Required additions to `packages/coding-agent/src/modes/rpc/rpc-types.ts`:

**New commands** (add to `RpcCommand` union):
```typescript
| { id?: string; type: "set_ask_mode"; enabled: boolean }
| { id?: string; type: "set_debug_mode"; enabled: boolean }
```

**New responses** (add to `RpcResponse` union):
```typescript
| { id?: string; type: "response"; command: "set_ask_mode"; success: true }
| { id?: string; type: "response"; command: "set_debug_mode"; success: true }
```

**State exposure** (add to `RpcSessionState`):
```typescript
mode?: "ask" | "debug"  // undefined = default agent mode
```

The Debug mode reproduction pause already has an RPC protocol path: `extension_ui_request { method: "confirm" }` is already defined in `RpcExtensionUIRequest`. But an end-to-end solution likely also needs RPC client support, because some clients currently ignore non-response, non-agent-event lines.

---

## Open questions before implementation

- Should slash commands stay as thin toggles over explicit session-level `enable/disable` helpers?
- Should Ask mode explicitly constrain delegated/sub-agent execution so the parent read-only posture cannot be bypassed?
- Log ingestion server: per-session (shut down on `/debug` toggle off) or per-workspace (shared across sessions)? `Bun.listen` on port 0 is the simplest port allocation — any objections?
- What timeout, if any, should Debug mode use for the reproduce/confirm prompt?
