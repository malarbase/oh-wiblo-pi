# Implementation Report: Agent-Driven Provider Onboarding

## Summary

Added non-interactive provider onboarding to the `/add-provider` slash command. The command now accepts positional arguments (`/add-provider <name> <baseUrl> <apiKey>`) alongside the existing TUI wizard, enabling the agent to parse arbitrary secrets files and onboard providers programmatically. A companion skill teaches credential extraction from Python, .env, curl, YAML, and JSON formats.

## Key Changes

**New files:**
- `packages/coding-agent/src/config/provider-probe.ts` — Endpoint introspection that GETs `/models`, detects OpenAI-compatible vs Ollama shapes, and returns API type, auth mode, discovery metadata, and available model list.
- `.omp/skills/onboard-provider/SKILL.md` — Skill definition teaching the agent to extract credentials from various file formats and invoke `/add-provider`.

**Modified files:**
- `packages/coding-agent/src/slash-commands/commands/add-provider.ts` — Added `handleAddProviderNonInteractive()` for the positional-args path. Modified `handleAddProviderTui` to early-return when args are present. Modified `handleAddProviderAcp` to support non-interactive invocation via ACP.
- `packages/coding-agent/src/slash-commands/builtin-registry.ts` — Added `allowArgs: true` and `inlineHint: "<name> <baseUrl> <apiKey>"` to the `add-provider` registry entry.

## Decisions

- **Inline fetch over reusing `validateApiKeyAgainstModelsEndpoint`** — The existing validator throws on failure and discards the response body; the probe needs the model list and non-throwing error handling. ~15 lines inline was simpler than adapting the shared helper.
- **Default to `openai-completions`** — Anthropic and Google endpoints don't expose `/models` in a standard shape; they'd get a fallback warning rather than a wrong inference. OpenAI-compatible is the safe default for any 200 response with a `data[]` array.
- **Skill at project level** — `.omp/skills/onboard-provider/` is the correct location; there's no bundled-skill mechanism.
