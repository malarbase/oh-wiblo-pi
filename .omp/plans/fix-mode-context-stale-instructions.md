# Fix: Move Mode Context from Conversation History to System Prompt

## Problem

When ask/plan mode activates, `sendAskModeContext()` / `sendPlanModeContext()` inject a custom message into conversation history containing the mode's system instructions. `convertToLlm()` converts these to `role: "user"` messages for the LLM. When the mode exits, the state flags are cleared but **the injected message persists** in history. On subsequent turns, the LLM sees stale mode instructions and continues behaving as if the mode is active.

Additionally, `switch_mode` is only available in ask/plan mode, preventing the agent from suggesting mode switches when the conversation drifts from agent/debug mode.

## Key Findings

### Zoo-Code's approach (the right pattern)
- Mode context lives entirely in the **system prompt**, never in conversation history
- `roleDefinition` is the **first** element in the generated prompt (`src/core/prompts/system.ts:95`)
- Mode switching triggers a full system prompt rebuild — old mode instructions are gone
- `switch_mode` is **always available** — agent can suggest mode switches from any mode
- `ask_followup_question` tool allows pre-filled prompt options with optional mode switch per suggestion

### Prompt caching constraints (all providers)
All major providers use **strict prefix matching**:
- Every byte from the start must be identical
- Minimum thresholds: 1,048 tokens (Anthropic/OpenAI), 2,048 (Gemini 2-family)

### owp's existing cache optimization
`rebuildSystemPrompt` is skipped when the tool set signature hasn't changed (`agent-session.ts:3443-3455`).

## Approach: System prompt with mode context at the END

```
┌─────────────────────────────────────────┐
│  STATIC PREFIX (cache anchor)           │  ← Always identical across turns
│  Base system prompt, tool guides,       │     Cache hit = 90% discount
│  coding rules, environment info         │
├─────────────────────────────────────────┤
│  DYNAMIC SUFFIX (volatile)              │  ← Changes on mode switch
│  Mode context block                     │     Cache miss only on this tail
└─────────────────────────────────────────┘
```

**Why mode context goes at the end, not the beginning:**
- Zoo-Code puts `roleDefinition` first, which breaks prefix caching on every mode switch
- For a terminal agent where turn latency matters, maximizing cache hit rate is worth moving mode context to the end
- The volatile tail is small (~200-500 tokens), so the cache miss cost is minimal

## Implementation Status

### Already Implemented ✓

1. **Added `#activeMode` field and getter** to InteractiveMode
2. **Created `#setActiveMode()` helper** — atomic mode transitions
3. **Routed all transitions through `#setActiveMode()`** — `handleAskModeCommand`, `handleDebugModeCommand`, `cycleAgentMode`, `handleSwitchModeTool`
4. **Added `#getModeContextBlock()` to AgentSession** — returns mode context for system prompt injection
5. **Updated `refreshBaseSystemPrompt()`** — appends mode context at end of system prompt
6. **Updated `#applyActiveToolsByName()`** — appends mode context when rebuilding system prompt
7. **Removed steer calls** from `#enterPlanMode` and `#enterGoalMode`
8. **Marked `sendAskModeContext`/`sendPlanModeContext`/`sendGoalModeContext` as `@deprecated`**

### Still Needed

1. **Update `#computeAppliedToolSignature`** to include mode state — ensures system prompt rebuilds on mode change
   - File: `packages/coding-agent/src/session/agent-session.ts` (line 3603)
   - Add `activeMode` parameter to signature computation

2. **Make `switch_mode` always available** — like Zoo-Code, allow the agent to suggest mode switches from any mode
   - File: `packages/coding-agent/src/tools/index.ts` (line 434)
   - Remove `askModeActive || planModeActive` guard — always return `true`
   - File: `packages/coding-agent/src/tools/switch-mode.ts` (line 21-24)
   - Expand schema to accept all modes: `z.enum(["agent", "ask", "plan", "debug", "goal"])`
   - File: `packages/coding-agent/src/prompts/tools/switch-mode.md`
   - Update tool description to guide LLM on when to suggest mode switches from any mode

3. **Update `handleSwitchModeTool`** to handle all mode transitions
   - File: `packages/coding-agent/src/modes/interactive-mode.ts` (line 1989)
   - Currently only handles "agent" and "ask" — add "plan", "debug", "goal"
   - Use `#setActiveMode()` for all transitions

4. **Add `ask_followup_question` tool with mode support** — like Zoo-Code, allow pre-filled prompt options with optional mode switch
   - New file: `packages/coding-agent/src/tools/ask-followup-question.ts`
   - Schema: `{ question: string, follow_up: Array<{ text: string, mode?: string }> }`
   - Each suggestion can optionally include a `mode` field
   - When user selects a suggestion with a mode, trigger mode switch via `#setActiveMode()`
   - File: `packages/coding-agent/src/tools/index.ts`
   - Register the new tool
   - File: `packages/coding-agent/src/prompts/tools/ask-followup-question.md`
   - Tool description with examples

## Files Modified

| File | Change |
|---|---|
| `packages/coding-agent/src/modes/interactive-mode.ts` | Added `#activeMode`, `#setActiveMode()`, routed transitions, removed steer calls, updated `handleSwitchModeTool` |
| `packages/coding-agent/src/session/agent-session.ts` | Added `#getModeContextBlock()`, updated `refreshBaseSystemPrompt()`, marked methods `@deprecated` |
| `packages/coding-agent/src/tools/index.ts` | Made `switch_mode` always available, registered `ask_followup_question` |
| `packages/coding-agent/src/tools/switch-mode.ts` | Expanded schema to accept all modes |
| `packages/coding-agent/src/prompts/tools/switch-mode.md` | Updated tool description |
| `packages/coding-agent/src/tools/ask-followup-question.ts` | New tool with mode support |
| `packages/coding-agent/src/prompts/tools/ask-followup-question.md` | New tool description |

## Files NOT Modified

| File | Reason |
|---|---|
| `packages/agent/src/agent.ts` | No changes to agent core |
| `packages/coding-agent/src/session/messages.ts` | `convertToLlm` unchanged — mode context no longer in history |
| `packages/coding-agent/src/modes/ask-mode/ask-mode-guard.ts` | Guard reads `#askModeState` which is still set correctly |

## Edge Cases

### Mode Switch During Streaming
One-turn delay is acceptable:
- Current turn continues with old system prompt (can't change mid-stream)
- Next turn uses updated system prompt
- Mode switches are user-initiated (rare)

### Goal/Plan Mode Per-Turn Injection
`#buildPlanModeMessage()` and `#buildGoalModeMessage()` inject mode context into conversation history on each turn. This is **intentional** because:
- Goal mode includes dynamic runtime state (tokens used, budget remaining)
- Plan mode includes dynamic state (plan file existence, workflow type)
- These states change on each turn and can't be captured in a static system prompt

## Verification

1. **Ask mode activation:** Enter ask mode → verify mode context appears in system prompt (last segment), NOT in conversation history
2. **Ask → Agent switch:** Switch to agent → verify ask mode context is gone from system prompt, `switch_mode` tool available
3. **Plan → Agent switch:** Same as above for plan mode
4. **Mode cycle:** Press alt+m → verify cycles through ask→debug→plan→agent without partial state
5. **Prefix cache stability:** Enable Anthropic prompt caching, switch modes, verify static prefix is still cached
6. **Existing tests:** Run `bun check` and `bun test` in `packages/coding-agent` — no regressions
7. **Streaming mode switch:** Start a long generation, switch modes mid-stream, verify next turn uses updated system prompt
8. **Agent suggests mode switch:** In agent mode, verify agent can call `switch_mode` to suggest switching to ask/plan/debug/goal mode
9. **Mode switch approval:** Verify user sees confirmation dialog with mode name and reason before mode switch happens
10. **ask_followup_question with mode:** Verify agent can present pre-filled prompt options with optional mode switch, and user selection triggers mode change
