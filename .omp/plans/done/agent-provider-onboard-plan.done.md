# Agent-Driven Provider Onboarding

## Context

The `/add-provider` slash command currently only works via an interactive TUI wizard. The goal is to make it callable with positional arguments (`/add-provider <name> <baseUrl> <apiKey>`) so the agent can parse arbitrary secrets files (Python, .env, curl, YAML) and drive provider onboarding non-interactively. A companion skill teaches the agent how to extract credentials from any file format.

## Approach

### Step 1: Create `provider-probe.ts` — endpoint introspection

**New file**: `packages/coding-agent/src/config/provider-probe.ts`

Exports a single async function:

```ts
export interface ProbeResult {
  baseUrl: string;
  apiKey: string;
  api: "openai-completions" | "openai-responses" | "anthropic-messages" | "bedrock-converse-stream" | "google-generative-ai" | "google-vertex" | "google-gemini-cli" | "openai-codex-responses" | "azure-openai-responses" | "openai-completions";
  auth: "apiKey" | "none";
  authHeader: boolean;
  discovery: { type: "ollama" | "llama.cpp" | "lm-studio" | "openai-models-list" | "openai-compatible" | "proxy" | "litellm"; timeoutMs?: number };
  models?: Array<{ id: string; name?: string }>;
  warnings: string[];
}

export async function probeEndpoint(
  baseUrl: string,
  apiKey: string,
  opts?: { signal?: AbortSignal },
): Promise<ProbeResult>;
```

Probe logic:
1. Normalize `baseUrl` — strip trailing `/`, ensure it doesn't end with `/v1` redundantly (but preserve if intentional).
2. `GET {baseUrl}/models` with `Authorization: Bearer {apiKey}`, 10s timeout.
3. If 200 + response has `data` array with objects containing `id` field → `api: "openai-completions"`, `discovery.type: "openai-compatible"`.
4. If 200 + response has `models` array (Ollama shape) → `discovery.type: "ollama"`.
5. If 401/403 → `auth: "apiKey"` (key required but wrong, or missing). If 200 without meaningful model data → `auth: "none"`.
6. Measure request RTT → `discovery.timeoutMs = Math.max(5000, Math.ceil(rtt * 3))`.
7. Parse model list from response: `models: data.map(m => ({ id: m.id, name: m.name }))`.
8. Default `authHeader: true` for all OpenAI-compatible APIs.
9. Catch network errors → set `warnings` with the error message, return partial result with safe defaults.

Reuse: `validateApiKeyAgainstModelsEndpoint` from `@oh-my-pi/pi-ai/registry/api-key-validation` does NOT fit directly (it throws on failure, doesn't return the model list). Write the fetch inline — it's ~15 lines and we need the response body, not just the status code.

### Step 2: Extend `/add-provider` with positional args

**Modified files**:
- `packages/coding-agent/src/slash-commands/commands/add-provider.ts` — add non-interactive branch
- `packages/coding-agent/src/slash-commands/builtin-registry.ts:2737-2741` — add `allowArgs: true` and `inlineHint: "<name> <baseUrl> <apiKey>"` to the registry entry

The TUI dispatcher (`executeBuiltinSlashCommand` in `builtin-registry.ts:3241`) calls `handleTui` directly — `handle` is ACP-only. So the arg-check must go inside `handleTui`.

Add a new function `handleAddProviderNonInteractive` that handles the positional-args path:

```ts
async function handleAddProviderNonInteractive(
  args: string,
  ctx: InteractiveModeContext,
): Promise<void> {
  const tokens = args.split(/\s+/).filter(Boolean);
  // tokens[0] = name, tokens[1] = baseUrl, tokens[2] = apiKey
}
```

Flow:
1. Parse `args` into `[name, baseUrl, apiKey]`. If fewer than 3 tokens → `ctx.showStatus("Usage: /add-provider <name> <baseUrl> <apiKey>")` and return.
2. Call `probeEndpoint(baseUrl, apiKey)` from Step 1.
3. Build config object from probe results:
   ```ts
   const config: Record<string, unknown> = {
     baseUrl: probe.baseUrl,
     apiKey: probe.apiKey,
     api: probe.api,
     auth: probe.auth,
     authHeader: probe.authHeader,
     discovery: probe.discovery,
   };
   ```
4. Call `addProviderToModelsConfig(name, config)` (already imported).
5. Call `ctx.session.modelRegistry.refresh("online")`.
6. Show status: `ctx.showStatus("Provider \"${name}\" added. Discovered ${probe.models?.length ?? 0} models.")`.

Modify `handleAddProviderTui` to check for args at the top:

```ts
async function handleAddProviderTui(
  command: Parameters<NonNullable<SlashCommandSpec["handleTui"]>>[0],
  runtime: Parameters<NonNullable<SlashCommandSpec["handleTui"]>>[1],
): Promise<undefined> {
  const ctx = runtime.ctx;

  // Non-interactive path: positional args → probe + write
  if (command.args.trim()) {
    await handleAddProviderNonInteractive(command.args, ctx);
    ctx.editor.setText("");
    return undefined;
  }

  // Interactive path: TUI wizard (existing code, unchanged)
  // ...
}
```

The ACP `handle` also gets the same arg check so it works outside TUI:

```ts
handle: async (command, runtime) => {
  if (command.args.trim()) {
    // ACP non-interactive: probe + write via output()
    const tokens = command.args.split(/\s+/).filter(Boolean);
    if (tokens.length < 3) {
      await runtime.output("Usage: /add-provider <name> <baseUrl> <apiKey>");
      return commandConsumed();
    }
    const [, baseUrl, apiKey] = tokens;
    const probe = await probeEndpoint(baseUrl, apiKey);
    const config = { baseUrl: probe.baseUrl, apiKey: probe.apiKey, api: probe.api, auth: probe.auth, authHeader: probe.authHeader, discovery: probe.discovery };
    await addProviderToModelsConfig(tokens[0], config);
    await runtime.session.modelRegistry.refresh("online");
    await runtime.output(`Provider "${tokens[0]}" added. Discovered ${probe.models?.length ?? 0} models.`);
    return commandConsumed();
  }
  await runtime.output("Provider onboarding requires interactive TUI mode. Usage: /add-provider <name> <baseUrl> <apiKey>");
  return commandConsumed();
},
```

### Step 3: Add the `onboard-provider` skill

**New file**: `.omp/skills/onboard-provider/SKILL.md`

Skills are discovered from `.omp/skills/` (project) or `~/.omp/agent/skills/` (user) by `builtin.ts:loadSkills` via `scanSkillsFromDir`. There is no bundled-skill mechanism — project-level `.omp/skills/` is the correct location.

Content of `SKILL.md`:

```markdown
---
name: onboard-provider
description: Onboard a new model provider from an endpoint URL and API key
---

When the user asks to add a provider from a secrets file, endpoint URL, or API key:

1. If given a file path, read it and extract `base_url`/`baseUrl` and `api_key`/`apiKey`. Common formats:
   - Python: `base_url = "..."`, `api_key = "..."`
   - .env: `BASE_URL=...`, `API_KEY=...`
   - curl: `-H "Authorization: Bearer ..."`, URL argument
   - YAML/JSON: `baseUrl`/`base_url`, `apiKey`/`api_key`
   - Markdown code blocks with any of the above

2. Infer a provider name from the URL hostname or file context (e.g., `integrate.api.nvidia.com` → `nvidia`).

3. Run the probe command:
   ```
   /add-provider <inferred-name> <baseUrl> <apiKey>
   ```

4. Report the result to the user. If warnings were returned, explain them.

If the user provides only a URL (no key), ask for the API key. If they provide only a key, ask for the endpoint URL.
```

## Critical files

| File | Why |
|---|---|
| `packages/coding-agent/src/config/provider-probe.ts` | New file — endpoint introspection logic |
| `packages/coding-agent/src/slash-commands/commands/add-provider.ts` | Modified — add non-interactive branch with positional args |
| `packages/coding-agent/src/slash-commands/builtin-registry.ts:2737-2741` | Registry entry for `add-provider` — verify `allowArgs` is set or implied |
| `packages/coding-agent/src/config/models-config-writer.ts` | Existing `addProviderToModelsConfig` — consumed as-is |
| `.omp/skills/onboard-provider/SKILL.md` | New file — teaches agent to parse secrets files |

## Verification

1. **Typecheck**: `bun check` in `packages/coding-agent/` — must pass with no errors.
2. **Manual TUI test**: Launch owp in dev mode (`OWP_DEV=1 ./bin/owp`), type `/add-provider nvidia https://integrate.api.nvidia.com/v1 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`, confirm provider is added to `models.yml` with correct fields.
3. **Error case**: `/add-provider` with no args → shows usage message. `/add-provider foo https://invalid.example.com key` → shows probe warning but still writes config.
4. **Skill availability**: After creating `.omp/skills/onboard-provider/SKILL.md`, verify the skill appears in the agent's skill list (check `skill://onboard-provider` resolves).

## Assumptions

- The TUI dispatcher calls `handleTui` directly (builtin-registry.ts:3241); `handle` is ACP-only. The arg-check goes inside `handleTui` for TUI and inside `handle` for ACP.
- `provider-probe.ts` defaults to `"openai-completions"` for any 200 response on `/models` with an OpenAI-shaped `data` array. Anthropic and Google endpoints don't expose `/models` the same way — they'd get a fallback warning rather than a wrong inference.
