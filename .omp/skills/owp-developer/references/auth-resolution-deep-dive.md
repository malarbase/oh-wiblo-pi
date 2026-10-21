# Auth Resolution Deep Dive

Reference for debugging API key resolution failures in owp's model registry.

## Three-Layer Resolution Architecture

### Layer 1: Sync Eager (`#eagerResolveCommandApiKeys()`)

Runs synchronously at `ModelRegistry` construction and after each `#reloadStaticModels()`.

```typescript
function resolveApiKeyConfigSync(keyConfig: string): string | undefined {
    if (!keyConfig.startsWith("!")) {
        return Bun.env[keyConfig] || keyConfig;  // env var or literal
    }
    const command = keyConfig.slice(1);  // strips "!"
    const result = Bun.spawnSync(["sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) return undefined;
    return result.stdout.toString().trim() || undefined;
}
```

**Failure modes:**
- Command exits non-zero (kubectl missing, wrong context) → `undefined`
- `Bun.spawnSync` env doesn't include shell-managed env vars (direnv, mise plugins)
- Output is empty after trim → `undefined`

### Layer 2: Async Refresh (`#resolveCommandApiKeys()`)

Runs during `refresh()` after discovery completes. Delegates to `resolveConfigValue()` which uses `pi-natives` `executeShell()`.

```typescript
async function resolveApiKeyConfigAsync(keyConfig: string): Promise<string | undefined> {
    return resolveConfigValue(keyConfig);  // uses executeShell from pi-natives
}
```

`executeShell()` creates a fresh `brush-core` shell:
- `do_not_inherit_env(true)` — starts clean
- Copies `std::env::vars()` into the shell session
- Does NOT read `process.env` or `Bun.env`

**Failure modes (same as sync + additional):**
- `executeShell` timeout (default 10s)` → `undefined`
- Caches failures in `commandResultCache` — persists for process lifetime

### Layer 3: AuthStorage Fallback Resolver

```typescript
this.authStorage.setFallbackResolver(provider => {
    const keyConfig = this.#customProviderApiKeys.get(provider);
    if (!keyConfig) return undefined;
    if (keyConfig.startsWith("!")) {
        return this.#resolvedCommandApiKeys.get(provider);  // Layer 1/2 result
    }
    return keyConfig;  // literal key
});
```

Called by `hasAuth(provider)` which filters the model picker. If Layer 1 failed and Layer 2 hasn't run yet, `hasAuth()` returns `false` and the model vanishes from the picker.

## Why `hasAuth` Sometimes Returns True After `/reload-models`

`/reload-models` triggers `refresh()` which runs Layer 2 (async). If Layer 1 failed but Layer 2 succeeds with the same command, `#resolvedCommandApiKeys` is populated and `hasAuth()` starts returning `true`. This explains why a model is sometimes missing at startup but appears after `/reload-models`.

## Diagnosing Which Layer Failed

Check logs for these clues:

| Log Message | Layer | Meaning |
|-------------|-------|---------|
| `ConfigError`, `schemaErrors` | Before Layer 1 | `models.yml` fails Zod validation |
| Provider missing from picker | Layer 1 | `resolveApiKeyConfigSync` returned `undefined` |
| `401 Invalid API key` (at runtime) | Layer 2/3 | Key resolved but is wrong value |
| Model appears after `/reload-models` | Layer 2 fixes Layer 1 | Env/async timing issue |

## Testing Resolution Manually

```typescript
// Replicate resolveApiKeyConfigSync exactly
const keyConfig = "!command kubectl --kubeconfig=/path get secret ... | base64 -d";
const command = keyConfig.slice(1);
const result = Bun.spawnSync(["sh", "-c", command], { stdout: "pipe", stderr: "pipe" });
console.log("exit:", result.exitCode);
console.log("out:", result.stdout.toString().slice(0, 10));
console.log("err:", result.stderr.toString());

// Test executeShell path
import { executeShell } from "@oh-my-pi/pi-natives";
let out = "";
const r = await executeShell({ command, timeoutMs: 10000 }, (e, c) => { if (!e) out += c; });
console.log("exit:", r.exitCode, "out:", out.slice(0, 10));
```

## The `command` Builtin Trap

When `keyConfig` is `"!command kubectl --kubeconfig=..."`, slicing off `!` yields:
```bash
command kubectl --kubeconfig=/x/y get secret ...
```

`command` is a POSIX builtin that suppresses alias/function lookup. It executes the named command directly. Critically, it does NOT process leading env assignments as shell side-effects — those are treated as the command name:

```bash
# WRONG: sh tries to run a command literally named "KUBECONFIG=/x/y"
command KUBECONFIG=/x/y kubectl get secret ...
# → sh: KUBECONFIG=/x/y: No such file or directory
```

Use `--flag` syntax for any tool that supports it (kubectl, aws, gcloud, etc.). For tools that only use env vars, wrap in `env`:
```bash
# Alternative if --flag unavailable
env KUBECONFIG=/x/y kubectl get secret ...
```
