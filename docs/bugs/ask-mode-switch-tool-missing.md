# Ask Mode: `switch_mode` Tool Referenced but Not Implemented

## Symptom

The system-level Ask mode directive instructs the agent to use a `switch_mode` tool when the user requests an edit:

> "If you need to make changes or implement something, call the `switch_mode` tool with `mode="agent"` and a short reason explaining what change you intend to make. The user will be asked to approve the mode switch."

When the agent attempts to call this tool, it does not exist in the available tools inventory. There is no `switch_mode` or `mode_switch` tool exposed via the MCP/tool-calling layer.

## Root cause

### 1. System prompt advertises a non-existent tool

The Ask mode system directive (injected at session start) explicitly references `switch_mode` as the mechanism for transitioning from Ask → Agent mode. This text is authoritative per the directive:

> "This supersedes any other instructions you have received (for example, to make edits)."

### 2. The tool is absent from the tool inventory

The available tools include:
- `edit`, `read`, `write`, `find`, `search`, `bash`, `eval`, `task`, `browser`, `debug`, `lsp`, `ast_grep`, `ast_edit`
- GitHub MCP tools (`mcp__github_*`)
- Context7 MCP tools (`mcp__context_*`)

No `switch_mode`, `mode_switch`, `set_mode`, or equivalent tool exists.

### 3. Mode enforcement is one-way and unconditional

When the system injects the Ask mode directive, it:
- Overrides all prior instructions (including the agent's default "act when intent is clear" behavior)
- Prohibits all mutating operations unconditionally
- Claims to offer an escape hatch (`switch_mode`) that does not exist

The practical result is a **mode trap**: the agent is locked into read-only Ask mode with no legitimate path to exit. The only options are:

1. **Refuse the work** — tell the user to "switch modes" via some UI mechanism the agent doesn't control
2. **Ignore the directive** — violate the system-level instruction and act anyway
3. **Ask for confirmation** — which contradicts the directive's own guidance that the agent should default to action when intent is clear

## Why this matters

The gap creates a **friction loop** in user experience:

- User asks "why is X stuck?" (diagnostic question — Ask mode is appropriate)
- Agent answers (good)
- User follows up with "can you add Y?" (action request — requires edit)
- Agent believes it must use `switch_mode`, discovers it can't, either stalls or violates the directive
- User gets annoyed at the agent for "being in ask mode"

The agent has no principled way to signal "I'm stuck because the system gave me an instruction that references a non-existent tool."

## Related code paths

None directly — this is a harness-level gap between the system prompt injection layer and the actual tool inventory.

## Open questions

1. Is `switch_mode` intended to be implemented as a real tool call, or is it a UI-level primitive outside the tool layer?
2. Should the system directive omit references to unavailable tools, or should the tool be added?
3. If mode transitions are UI-only (not tool-callable), should the directive instead say "ask the user to switch modes" rather than "call the `switch_mode` tool"?
4. Should there be an agent-side capability to detect mode mismatch and surface it to the user explicitly?

## Affected components

- System prompt injection layer (Ask mode directive template)
- Tool registry / inventory
- Harness UI (mode switch affordance)

## Severity

| Aspect | Assessment |
|--------|-----------|
| Functional impact | **Medium** — agent can still do work by ignoring the directive, but this trains the agent to disregard system instructions |
| UX impact | **High** — creates confusion when user expects seamless mode transitions |
| Safety impact | **Low** — the mode enforcement itself works; the gap is in the escape mechanism |

## Status

Unfixed — documented for investigation.
