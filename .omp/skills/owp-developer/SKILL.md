---
name: owp-developer
description: Debug and develop oh-wiblo-pi (owp), a fork of oh-my-pi. Covers tmux-based TUI debugging, API key resolution, model registry auth, YAML config gotchas, Bun.spawnSync behavior, log analysis, and iterative fix loops. Use when debugging owp interactive sessions, model picker issues, provider authentication, config file parsing, or any owp runtime behavior.
---

# OWP Developer Skill

Debug and develop oh-wiblo-pi (owp) — a coding-agent CLI built on Bun with a custom TUI. This skill bridges the gap between "something's broken" and "fixed and verified."

## First Principles

1. **Always use tmux** — never run `owp` directly in your terminal. It blocks, corrupts on crash, and leaves the TUI in a bad state.
2. **Reproduce first** — confirm the bug is real before changing code.
3. **Add logging at boundaries** — API calls, auth checks, config resolution. Remove after debugging.
4. **Check logs** — owp logs structured JSON to `~/.omp/logs/omp.YYYY-MM-DD.log`.
5. **Verify both paths** — streaming previews and transcript rebuilds can diverge.

## Launch Pattern

```bash
tmux kill-session -t owp-debug 2>/dev/null; sleep 1
tmux new-session -d -s owp-debug \
  'cd /var/home/user/Work/oh-wiblo-pi && eval "$(mise env)" && OWP_DEV=1 ./bin/owp'
sleep 5  # wait for startup + model load
tmux capture-pane -t owp-debug -p | tail -20
```

**Mise-managed tools:** tmux sessions don't inherit mise shell hooks. Always `eval "$(mise env)"` inside the tmux command, or the wrapper script fails with `bun: not found`.

## Session Lifecycle

| Action | Command |
|--------|---------|
| Create | `tmux new-session -d -s <name> '<command>'` |
| Send | `tmux send-keys -t <name> '<text>' C-m` |
| Capture | `tmux capture-pane -t <name> -p \| tail -N` |
| Kill | `tmux kill-session -t <name>` |

**Always kill the session when done.** Multiple `owp` processes fight for the terminal.

## Debugging API Key / Auth Issues

### Symptom: "401 Invalid API key" or model missing from picker

1. Check if the provider appears in the picker: `Alt+P` → look for provider tab.
2. If missing, auth resolution failed during load. Check logs for schema/validation errors.
3. Verify the command resolves manually:
   ```bash
   # Copy exact command from models.yml, strip !command prefix
   kubectl --kubeconfig=/path/to/kubeconfig get secret ... | base64 -d | wc -c
   ```

### Critical: YAML `!command` Tag Behavior

Bun's `YAML.parse()` strips unquoted `!command` tags:
```yaml
# WRONG — tag stripped, entire command treated as literal API key
apiKey: !command kubectl ...

# RIGHT — quoted, preserves !command prefix  
apiKey: "!command kubectl ..."
```

Always quote `!command` values in `models.yml`.

### Critical: `command` Shell Builtin Trap

`resolveApiKeyConfigSync` slices `!` off the front, passing `command <rest>` to `sh -c`.
The `command` builtin does NOT execute variable assignments as side effects:
```bash
# WRONG — sh runs 'command KUBECONFIG=/x/y kubectl ...'
# 'command' ignores leading env assignments; 'KUBECONFIG=/x/y' fails as cmd-not-found

# RIGHT — pass --kubeconfig flag instead of env var
apiKey: "!command kubectl --kubeconfig=/x/y get secret ..."
```

## Model Registry Auth Flow

Three resolution paths for API keys (check `packages/coding-agent/src/config/model-registry.ts`):

1. **Sync eager** (`#eagerResolveCommandApiKeys()`) — `Bun.spawnSync`, runs at constructor/reload time.
2. **Async refresh** (`#resolveCommandApiKeys()`) — `resolveConfigValue()` via `pi-natives` `executeShell`, runs during `refresh()`.
3. **Fallback resolver** (`authStorage.setFallbackResolver()`) — checked by `hasAuth()` for TUI filtering.

The fallback resolver reads from `#resolvedCommandApiKeys` cache. If the sync eager path fails, `hasAuth("myprovider")` returns `false` and the model is excluded from the picker.

### `Bun.spawnSync` Env Inheritance Gotcha

`Bun.spawnSync(["sh", "-c", cmd], { stdout: "pipe" })` inherits `process.env` by default in Bun, but `executeShell` from `pi-natives` creates a fresh `brush-core` shell with `do_not_inherit_env(true)`, then manually copies `std::env::vars()`. If `process.env` differs from the shell env (e.g., direnv-managed `KUBECONFIG`), inline the env variable in the command or use `--flag` equivalents.

## OWP Log Analysis

Log path: `~/.omp/logs/omp.YYYY-MM-DD.log` (JSON Lines)

```bash
# Recent errors/warnings for a provider
jq 'select(.level == "warn" or .level == "error") | {time: .timestamp, msg: .message, provider: .provider, err: .error}' \
  ~/.omp/logs/omp.$(date +%Y-%m-%d).log | tail -30

# Check if a provider loaded at all
grep -i "hermes\|provider" ~/.omp/logs/omp.YYYY-MM-DD.log | tail -20

# Schema validation errors
grep -i "schema\|validation\|config error" ~/.omp/logs/omp.YYYY-MM-DD.log | tail -10
```

## Adding Debug Logging

Target boundaries — never scatter logging throughout a function:

```typescript
// Good: log input/output at a boundary
logger.debug("Resolving API key for provider", { provider, keyConfig: keyConfig.slice(0, 20) });
const resolved = await resolveConfigValue(keyConfig);
logger.debug("Resolved API key", { provider, resolved: Boolean(resolved), length: resolved?.length });
```

Log to `~/.omp/logs/{app}.{YYYY-MM-DD}.log`. Rotate automatically. Remove before committing.

## Iterative Debug Loop

```bash
# 1. Kill stale session
# 2. Add logging in code
# 3. Relaunch
# 4. Send test message, capture
# 5. Check logs
# 6. Fix, remove logging, re-test
tmux kill-session -t owp-debug 2>/dev/null; sleep 1
tmux new-session -d -s owp-debug \
  'cd /var/home/user/Work/oh-wiblo-pi && eval "$(mise env)" && OWP_DEV=1 ./bin/owp'
sleep 5
tmux send-keys -t owp-debug '/reload-models' C-m && sleep 6
tmux send-keys -t owp-debug 'hello, test message' C-m && sleep 10
tmux capture-pane -t owp-debug -p | tail -25
```

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Unquoted `!command` in YAML | `401 Invalid API key` — literal command string sent as key | Quote the value: `"!command ..."` |
| `command` builtin + env assignment | `sh: KUBECONFIG=...: No such file or directory` | Use `--flag` instead of env var |
| Stale tmux session | TUI corruption, "already running" errors | `tmux kill-session -t owp-debug` |
| Missing `eval "$(mise env)"` | `bun: not found` inside tmux | Include mise env in tmux command |
| Models.yml schema error | Provider missing from picker entirely | Check logs for `ConfigError`/`schemaErrors` |
| Sync eager resolution fails | Model missing from picker, works after `/reload-models` | Check `Bun.spawnSync` env inheritance |

## Key Files

| File | Purpose |
|------|---------|
| `packages/coding-agent/src/config/model-registry.ts` | Model loading, auth resolution, `!command` handling |
| `packages/coding-agent/src/config/resolve-config-value.ts` | Async `!command` resolution via `executeShell` |
| `packages/coding-agent/src/config/models-config-schema.ts` | Zod schema for `models.yml` validation |
| `~/.omp/agent/models.yml` | User provider configs (API keys, base URLs, models) |
| `~/.omp/logs/omp.YYYY-MM-DD.log` | Runtime logs (JSON Lines) |
| `packages/ai/src/auth-storage.ts` | Credential storage, `hasAuth()`, fallback resolver |
| `crates/pi-natives/src/shell.rs` | `executeShell` Rust impl (brush-core shell) |
| `crates/pi-shell/src/shell.rs` | `create_session` with env inheritance logic |

## References

- **Auth resolution deep dive**: See [references/auth-resolution-deep-dive.md](references/auth-resolution-deep-dive.md) for the three-layer auth architecture, `hasAuth` filtering, and diagnosing which layer failed.
- **YAML config gotchas**: See [references/yaml-config-gotchas.md](references/yaml-config-gotchas.md) for Bun YAML.parse behavior, Zod schema validation, and common `models.yml` mistakes.
- **Shell environment gotchas**: See [references/shell-env-gotchas.md](references/shell-env-gotchas.md) for `Bun.spawnSync` vs `executeShell` env handling, mise/direnv in tmux, and the owp bash tool env behavior.
