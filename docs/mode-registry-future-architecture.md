# Mode Registry — Future Architecture (Deferred)

## Context

This document records a deliberate deferral: owp (oh-wiblo-pi) does **not** build a
Zoo-Code-style `ModeConfig` abstraction or support custom modes in the current
implementation. The `switch_mode` tool shipped alongside this doc is the load-bearing
bridge to that future — its `mode: z.enum(["agent", "ask"])` parameter is designed to
widen to `mode: string` (resolved against a future `ModeRegistry`) **without** changing
the tool's signature, the event-controller reaction, or the `handleSwitchModeTool`
interface. This doc captures why the registry was deferred and what prerequisites would
reopen the decision, so the next engineer (or future-you after a rebase) doesn't
relitigate it.

Reference points:

- omp's current `switch_mode` tool: `packages/coding-agent/src/tools/switch-mode.ts`
- omp's `ToolSession` accessor: `getAskModeState?: () => AskModeState | undefined`
  (`packages/coding-agent/src/tools/index.ts`, next to `getPlanModeState`).
- omp's ask-mode guard: `packages/coding-agent/src/modes/ask-mode/ask-mode-guard.ts`
- Zoo-Code's `ModeConfig` shape: `/var/home/user/Work/Deps/Zoo-Code/src/shared/modes.ts`
- Zoo-Code's `switch_mode` tool: `/var/home/user/Work/Deps/Zoo-Code/src/core/tools/SwitchModeTool.ts`

## Current state (what exists today)

omp's modes are a **hardcoded status-line enum**, not first-class profiles:

- `SegmentContext.agentMode.mode: "none" | "plan" | "ask" | "debug"`
  (`packages/coding-agent/src/modes/components/status-line/types.ts:31`).
- Each mode has **bespoke lifecycle hooks** that do not collapse into a generic
  `ModeConfig.{roleDefinition, groups}` shape:
  - plan mode: `enablePlanMode` + `setStandingResolveHandler(createPlanApprovalResolveHandler(...))`
    (`agent-session.ts` ~line 3895) — registers the standing `resolve` handler so
    `resolve({ action: "apply" })` routes through `handlePlanApproval` and the
    save-and-exit selector. Lossy to express generically.
  - ask mode: `enableAskMode` / `sendAskModeContext` / `disableAskMode`
    (`agent-session.ts` ~lines 9542–9556) + `enforceAskModeGuard`
    (`ask-mode-guard.ts`) wired into `bash`/`write`/`edit`/`patch` `execute()` methods
    via `session.getAskModeState?.()`.
  - debug mode: log server lifecycle (`#enterDebugModeInternal` /
    `startLogServer` / `disableDebugMode`). See `docs/debug-mode-lifecycle.md`.
- Each mode injects a `*-context.md` system message
  (`prompts/system/ask-mode-context.md`, `plan-mode-active.md`, `debug-mode-context.md`).
- Mode cycling is a hardcoded `cycleAgentMode()` sequence: ask → debug → plan → agent
  (`packages/coding-agent/src/modes/interactive-mode.ts` ~line 2039).
- `AgentDefinition` (`packages/coding-agent/src/task/types.ts:166`) is an unrelated
  abstraction used for **subagent spawning** via the `task` tool
  (fields: `name`, `description`, `systemPrompt`, `tools`, `spawns`, `model`,
  `thinkingLevel`, `autoloadSkills`). It is NOT a session-mode abstraction.
- `AgentRegistry` (`packages/coding-agent/src/registry/agent-registry.ts`) is a runtime
  session registry for IRC peer routing across live sessions, not a mode/profile
  abstraction.
- `ModelRole` (`default`/`smol`/`slow`/`plan`/`designer`/`commit`/`task`/`vision`) in
  `packages/coding-agent/src/config/model-registry.ts:105` is a **model selector
  tier**, also unrelated to Zoo's `ModeConfig`.

## What a full ModeConfig would look like (the Zoo-Code shape)

For reference, Zoo-Code's `ModeConfig` structurally decouples "what this mode does"
from "how it's implemented":

```ts
interface ModeConfig {
  slug: string;            // "architect" | "code" | "ask" | "debug" | "orchestrator" | ...
  name: string;
  roleDefinition: string; // the system prompt for this mode
  whenToUse: string;
  customInstructions: string;
  groups: string[];        // tool-group allowlist (replaces omp's per-mode guard)
  description: string;
}
```

- `DEFAULT_MODES: ModeConfig[]` — built-in modes.
- `customModes: ModeConfig[]` — user-defined modes, stored in VSCode globalState.
- `getModeBySlug(slug, customModes)` — custom-first lookup.
- `getAllModes(customModes)` — merged default+custom, override-by-slug.
- `switch_mode({ mode_slug })` — takes any slug string, resolved against
  `getAllModes`; user approves via `askApproval("tool", ...)`.
- `alwaysAllowModeSwitch: true` auto-approves.

## Decision

**Defer building a `ModeConfig` registry and custom-modes support.** Ship the
`switch_mode` tool with a fixed `mode: z.enum(["agent", "ask"])` parameter. The enum
is the seam where a future `ModeRegistry` plugs in; widening it to a slug string
requires changing only the parameter validation, not the tool's contract.

## Why deferred

Four reasons, in priority order:

1. **omp's modes are behavioral session states, not agent profiles.** Each mode has
   bespoke lifecycle semantics: plan mode's `resolve`/`plan_approval` standing handler,
   ask mode's in-tool guard (`enforceAskModeGuard`), debug mode's log server. Collapsing
   these into `ModeConfig.{roleDefinition, groups}` loses each mode's bespoke behavior.
   A generic registry would have to express each lifecycle as hooks — the deepest
   possible refactor, touching every mode's code.

2. **omp already has the abstraction the registry would invent — `AgentDefinition`.**
   But it serves `task`-tool subagent spawning, not session modes. Either invent a
   parallel `ModeConfig` type (duplication + drift) or retrofit modes to BE
   `AgentDefinition`s (deepest refactor; touches every mode lifecycle file).

3. **The fork's rebase-fragility is the binding constraint.** The ask-mode guard was
   *already lost once* to a history rebuild precisely because it lived in the
   most-rebased shared file (`agent-session.ts`). A mode-registry refactor multiplies
   that surface across `agent-session.ts`, `interactive-mode.ts`,
   `event-controller.ts`, `status-line` — all maximally-rebiased shared files. The
   in-tool-guard pattern shipped here (`ask-mode-guard.ts` + one-line `execute()` calls
   + `getAskModeState` accessor on `ToolSession`) was specifically chosen because it
   has provably survived the same rebases that killed the wrapper-based approach.

4. **Upstream omp has no mode-registry precedent.** Building it is fork-only, maximizing
   future rebase conflict. Where upstream has not signaled a direction, tracking
   upstream is cheaper than diverging.

## Prerequisites that would reopen this

Revisit the registry decision when ANY of these becomes true:

- **Upstream lands a first-class `ModeConfig` or `AgentProfile`** we can adopt rather
  than fork-diverging. The cheapest path is to consume upstream's abstraction.
- **User-driven demand for custom modes** — modes beyond ask/plan/debug/goal/agent
  that users want to author themselves. Until then, the hardcoded enum suffices.
- **Per-mode `roleDefinition`** (not just context-message injection) becomes a
  requirement. Today each mode injects a `*-context.md` system message; if modes need
  full prompt replacement, the registry abstraction starts paying for itself.
- **`switch_mode`'s `mode` enum needs to widen to a slug string parameter.** This is
  the load-bearing seam — when it does, the registry plugs in here. The tool's
  contract, the event-controller reaction (`handleSwitchModeTool`), and the
  `InteractiveMode.handleSwitchModeTool` implementation all stay unchanged; only the
  param schema widens and a `ModeRegistry` resolves the slug to a mode-lifecycle
  handler.

## Bridge from this implementation

The `switch_mode` tool implemented in `packages/coding-agent/src/tools/switch-mode.ts`
is that load-bearing bridge. Specifically:

- **Param shape**: `mode: z.enum(["agent", "ask"])` widens to `mode: z.string()` by
  replacing one line in the schema. The `SwitchModeDetails { targetMode, reason }`
  interface already uses `string`, not the enum, so callers don't change.
- **Reaction pattern**: `event-controller.ts` reacts to a successful `switch_mode`
  execution by calling `ctx.handleSwitchModeTool(details)`. This is mode-agnostic —
  when a registry exists, `handleSwitchModeTool` dispatches to the registered
  mode-lifecycle handler (entered/exited) keyed by `details.targetMode`.
- **Gate**: `isToolAllowed("switch_mode") = askModeActive || planModeActive` in
  `createTools` (`packages/coding-agent/src/tools/index.ts`). When a registry exists,
  this becomes "the target mode is registered and the current mode permits
  transitions to it" — still a one-liner.

## Out of scope for the registry work

- **goal↔agent and debug↔agent transitions** via `switch_mode` are not wired today
  (only ask↔agent and plan→agent). The registry would subsume these as part of the
  generic mode-lifecycle handler.
- **Refactoring `wrapToolWithAskModeGuard` away entirely.** Kept as defense-in-depth
  for MCP/extension tools that don't have in-tool guards. The primary enforcement
  path is `enforceAskModeGuard` calls inside each tool's `execute()`.
- **Changing the `resolve`/`plan_approval` flow.** Plan mode's "approve and execute"
  path (`resolve({ action: "apply" })` → `handlePlanApproval` → selector) is
  untouched by the registry — it's the plan-artifact flow, orthogonal to mode
  switching. Only the plain "exit plan mode" path is subsumed by `switch_mode`.
