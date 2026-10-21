# Cache token tracking

This document describes how prompt cache tokens (`cacheRead`, `cacheWrite`) flow from provider API responses into session storage and the stats dashboard, and what works or does not work for each provider path.

## The `Usage` shape

Every `AssistantMessage` carries a `Usage` object (`packages/ai/src/types.ts`):

```ts
interface Usage {
  input:       number;   // uncached input tokens
  output:      number;   // output tokens
  cacheRead:   number;   // tokens read from prompt cache
  cacheWrite:  number;   // tokens written to prompt cache
  totalTokens: number;   // input + output + cacheRead + cacheWrite
  cost: {
    input:      number;
    output:     number;
    cacheRead:  number;
    cacheWrite: number;
    total:      number;
  };
}
```

`input` counts only tokens that were **not** served from cache. `totalTokens` is the sum of all four buckets.

`calculateCost()` (`packages/ai/src/models.ts`) multiplies each bucket by the per-million rate from the model's `cost` config. If those rates are zero (as they are for all `litellm` built-in models), the cost fields stay zero even when token counts are non-zero.

## How each provider populates cache tokens

### Anthropic (`anthropic-messages`)

Source: `packages/ai/src/providers/anthropic.ts`

Reads `cache_read_input_tokens` and `cache_creation_input_tokens` directly from the Anthropic streaming events:

- `message_start.message.usage` — initial values
- `message_delta.usage` — updated values in the final delta

Both `cacheRead` and `cacheWrite` are correctly populated for all Anthropic requests where prompt caching is active.

### OpenAI-compatible (`openai-completions`)

Source: `packages/ai/src/providers/openai-completions.ts`, `parseChunkUsage()`

The OpenAI usage schema exposes cache reads under `prompt_tokens_details.cached_tokens`. Cache writes have no standard field in the OpenAI spec.

Resolution order for each bucket:

| Bucket | Fields checked (in order) |
|---|---|
| `cacheRead` | `rawUsage.cached_tokens` → `rawUsage.prompt_tokens_details.cached_tokens` → `rawUsage.cache_read_input_tokens` |
| `cacheWrite` | `rawUsage.cache_creation_input_tokens` → `rawUsage.prompt_tokens_details.cache_write_tokens` |

The `cache_read_input_tokens` and `cache_creation_input_tokens` fallbacks exist specifically for proxies (LiteLLM, similar gateways) that pass Anthropic-native fields through as extra properties on the OpenAI-compat usage object.

`input` is computed as `prompt_tokens - cacheRead - cacheWrite`, so cache tokens are never double-counted as input.

### All other providers

`openai-responses`, `cursor`, `kimi`, `openai-codex-responses` (streaming path): `cacheRead` and `cacheWrite` are hardcoded to zero. These providers either do not expose prompt cache semantics or do not yet have mapping logic implemented.

## LiteLLM proxy with Anthropic models

When routing Anthropic models through a LiteLLM OpenAI-compatible endpoint, the response goes through the `openai-completions` provider path.

LiteLLM passes Anthropic's cache token counts through in the usage object as extra fields:

```json
{
  "usage": {
    "prompt_tokens": 1200,
    "completion_tokens": 300,
    "total_tokens": 1500,
    "cache_read_input_tokens": 1000,
    "cache_creation_input_tokens": 200
  }
}
```

The `openai-completions` provider reads both fields. With the above example:

- `cacheRead` = 1000
- `cacheWrite` = 200
- `input` = 1200 − 1000 − 200 = 0 (all input was cached)
- `totalTokens` = 0 + 300 + 1000 + 200 = 1500

### Known LiteLLM limitations

- **`cache_creation_input_tokens` may be missing** in older LiteLLM versions or certain routing paths (notably OpenRouter-routed Anthropic calls). In that case `cacheWrite` is 0.
- **Streaming usage chunks**: LiteLLM must be configured with `always_include_stream_usage: true` (proxy `config.yaml`) or the client must send `stream_options: {"include_usage": true}`. Without this, the final usage chunk is omitted and all token counts are 0.
- **Cost fields remain 0** for built-in `litellm` provider models because their `cost.cacheRead` and `cost.cacheWrite` rates in `models.json` are set to 0. Set the correct Anthropic cache rates in your `models.yml` model entry to fix this:

```yaml
providers:
  my-litellm:
    baseUrl: https://my-litellm-proxy/v1
    apiKey: LITELLM_API_KEY
    api: openai-completions
    models:
      - id: claude-opus-4-5
        name: Claude Opus 4.5 (via LiteLLM)
        contextWindow: 200000
        maxTokens: 32768
        cost:
          input: 15        # $/million tokens
          output: 75
          cacheRead: 1.5   # 10% of input rate
          cacheWrite: 18.75 # 125% of input rate
```

## Stats dashboard

The stats dashboard (`packages/stats`) reads `cacheRead` and `cacheWrite` from `AssistantMessage.usage` in session JSONL files. It computes `cacheRate` as:

```
cacheRate = totalCacheReadTokens / (totalCacheReadTokens + totalInputTokens)
```

If both `cacheRead` and `cacheWrite` are 0 in the stored messages, the dashboard will show 0% cache rate. The fix is upstream — ensure token counts are populated correctly at request time, not in the stats parser.

## Diagnostic checklist

Cache tokens showing as 0 in the dashboard:

1. **Provider path**: only `anthropic-messages` and `openai-completions` populate cache tokens. Check which `api` your model uses.
2. **LiteLLM streaming usage**: verify `always_include_stream_usage: true` is set in your proxy config, or that owp sends `stream_options.include_usage`.
3. **LiteLLM version**: `cache_creation_input_tokens` passthrough has had bugs in older versions. Upgrade to a recent LiteLLM release.
4. **Prompt caching active**: caching only activates when the prompt exceeds the provider's minimum cacheable token threshold (1024 tokens for Anthropic). Short sessions produce no cache tokens regardless of config.
5. **Cost stays 0**: cost fields are separate from token counts — set non-zero `cost.cacheRead` / `cost.cacheWrite` in your `models.yml` model entry.

## Implementation files

- [`packages/ai/src/types.ts`](../packages/ai/src/types.ts) — `Usage` interface
- [`packages/ai/src/models.ts`](../packages/ai/src/models.ts) — `calculateCost()`
- [`packages/ai/src/providers/anthropic.ts`](../packages/ai/src/providers/anthropic.ts) — native Anthropic cache token mapping
- [`packages/ai/src/providers/openai-completions.ts`](../packages/ai/src/providers/openai-completions.ts) — `parseChunkUsage()`, OpenAI-compat + LiteLLM passthrough fields
- [`packages/stats/src/parser.ts`](../packages/stats/src/parser.ts) — reads `msg.usage` from session JSONL
- [`packages/stats/src/db.ts`](../packages/stats/src/db.ts) — stores and aggregates cache token columns
