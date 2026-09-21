# YAML and Config Gotchas

Concrete edge cases that cause silent failures in owp configuration.

## Bun YAML.parse() Strips Unquoted Tags

Bun's `YAML.parse()` from `bun:sqlite` (also exposed as `bun.YAML`) does not preserve custom YAML tags. It silently strips them and returns the scalar value.

```typescript
const { YAML } = require("bun");

YAML.parse("apiKey: !command echo hello");
// → { apiKey: "echo hello" }     // !command stripped!

YAML.parse('apiKey: "!command echo hello"');
// → { apiKey: "!command echo hello" }  // preserved with quotes

YAML.parse("apiKey: !command kubectl get secret ...");
// → { apiKey: "kubectl get secret ..." }  // tag gone, whole command treated as literal key!
```

**Rule:** Always double-quote `!command` values in `models.yml`.

```yaml
# WRONG — Bun strips !command, sends literal "kubectl ..." as API key → 401
apiKey: !command kubectl get secret ...

# RIGHT — preserved as string starting with "!command"
apiKey: "!command kubectl --kubeconfig=/path get secret ..."
```

## models.yml Discovery Schema

The `discovery` field must match `ProviderDiscoverySchema`:

```typescript
export const ProviderDiscoverySchema = z.object({
    type: z.enum(["ollama", "llama.cpp", "lm-studio", "openai-models-list", "openai-compatible"]),
});
```

**Common mistake:** Using `openai` instead of `openai-compatible`.

```yaml
# WRONG
    discovery:
      type: openai

# RIGHT
    discovery:
      type: openai-compatible
```

Schema validation errors are logged at `warn` level but don't crash owp. The provider is silently dropped.

## Config File Resolution Order

1. `models.json` — generated cache of discovered models, updated by `refresh()`
2. `models.yml` — user config with provider overrides and custom models
3. Built-in models from `models.json` in `@oh-my-pi/pi-ai`
4. Runtime-discovered models (Ollama, llama.cpp, etc.)

When debugging "where did this model come from?", check `~/.omp/agent/models.db` (SQLite) and grep for the model ID in logs during `refresh()`.

## Zod Schema Validation Failures

`ConfigFile.load()` uses `schema.safeParse()`. Failures produce:

```json
{
  "level": "warn",
  "message": "Failed to parse config file",
  "path": "/var/home/user/.omp/agent/models.yml",
  "error": {
    "id": "models",
    "schemaErrors": [
      { "instancePath": "/providers/hermes/discovery/type", "message": "Invalid enum value" }
    ]
  }
}
```

The entire config is rejected — not just the invalid provider. A single typo in one provider can hide all custom providers from the picker.
