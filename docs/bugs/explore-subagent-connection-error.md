# Explore subagent fails with "Connection error."

## Symptom

Spawning the bundled `explore` agent via the `task` tool fails immediately:

```xml
<agent id="ExploreFailureDiag" agent="explore">
  <status>failed (exit 1)</status>
  <meta lines="1" size="0B" />
  <result>Connection error.</result>
</agent>
```

Failure duration is **~114 ms**, which is too fast for a successful HTTP round-trip — indicating a DNS or TCP-level failure during provider client initialization rather than a model inference timeout.

## Root cause

### 1. Explore agent targets `pi/smol`

The `explore` agent frontmatter declares:

```yaml
model: pi/smol
```

[`packages/coding-agent/src/prompts/agents/explore.md`](packages/coding-agent/src/prompts/agents/explore.md)

### 2. `pi/smol` resolves through a priority fallback chain

`resolveConfiguredRolePattern` and `expandRoleAlias` map `pi/smol` to the ordered list in `priority.json`:

```json
"smol": [
  "cerebras/zai-glm-4.7",
  "cerebras/zai-glm-4.6",
  "cerebras/zai-glm",
  "haiku-4-5",
  "haiku-4.5",
  "haiku",
  "flash",
  "mini"
]
```

[`packages/coding-agent/src/priority.json`](packages/coding-agent/src/priority.json)

### 3. Resolution falls through to Anthropic models

If the Cerebras models are **not present** in the local `ModelRegistry`'s available list (e.g. because the provider is not configured or the models were not discovered), `resolveModelOverride` / `parseModelPattern` falls through to bare IDs like `haiku-4-5`, `haiku`, etc. These IDs match **Anthropic** models in the registry.

[`packages/coding-agent/src/config/model-resolver.ts`](packages/coding-agent/src/config/model-resolver.ts)

### 4. Subagent session routes through the Anthropic provider client

`runSubprocess` calls `resolveModelOverrideWithAuthFallback`, then `createAgentSession`, then `session.prompt()`. The prompt triggers the first `fetch()` to the provider. For Anthropic models this routes through `AnthropicMessagesClient.#send()`.

[`packages/coding-agent/src/task/executor.ts`](packages/coding-agent/src/task/executor.ts)

### 5. `fetch()` fails fast with hard-coded "Connection error."

The Anthropic client retries up to `maxRetries` (default 2) with exponential backoff starting at 0.5 s. The 114 ms total means the very first `fetch()` never completed TCP handshake — DNS NXDOMAIN, connection refused, or the endpoint is unreachable.

When retries are exhausted, the client throws `AnthropicConnectionError` whose message is exactly the hard-coded string `"Connection error."`:

```typescript
class AnthropicConnectionError extends Error {
  constructor(cause: Error) {
    super("Connection error.");
    ...
  }
}
```

[`packages/ai/src/providers/anthropic-client.ts`](packages/ai/src/providers/anthropic-client.ts)

## Why the subagent path is different from the parent session

The parent Ask-mode session may be running through a separate harness inference pipeline. Subagents spawned via `task` go through the full native `coding-agent` session path (`createAgentSession` → `Agent` loop → provider `fetch`), which attempts a **real provider network call**.

## Related code paths

- Subagent spawn: `TaskTool.#executeSync` → `runSubprocess`
- Model resolution: `resolveModelOverrideWithAuthFallback` → `resolveModelOverride` → `resolveModelRoleValue` → `parseModelPattern`
- Session creation: `createAgentSession` in `packages/coding-agent/src/sdk.ts`
- Prompt execution: `AgentSession.prompt` → underlying `Agent` loop → `streamSimple`
- Provider client: `AnthropicMessagesClient.#send` in `packages/ai/src/providers/anthropic-client.ts`

## Open questions

1. Are the Cerebras models present in `modelRegistry.getAvailable()` in this environment?
2. Is the parent's active model pattern being passed correctly so `resolveModelOverrideWithAuthFallback` can route the subagent to the parent's authenticated model?
3. Is there network access to `api.anthropic.com` from where subagents run?
4. Should `pi/smol` have a local / offline fallback when the environment cannot reach remote providers?

## Status

Unfixed — documented for investigation.
