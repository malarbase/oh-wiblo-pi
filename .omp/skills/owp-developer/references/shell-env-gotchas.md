# Shell Environment Gotchas in owp

How `Bun.spawnSync`, `pi-natives/executeShell`, and tmux sessions handle environment variables differently.

## Bun.spawnSync — Inherits `process.env` by Default

```typescript
// Default — inherits process.env
const r1 = Bun.spawnSync(["sh", "-c", "echo KUBECONFIG=$KUBECONFIG"], { stdout: "pipe" });
// stdout includes KUBECONFIG if process.env has it

// Explicit spread — same behavior, explicit
const r2 = Bun.spawnSync(["sh", "-c", "echo KUBECONFIG=$KUBECONFIG"], {
    stdout: "pipe",
    env: { ...process.env }
});
```

**Key point:** `Bun.spawnSync` DOES inherit env. The confusion comes from `executeShell` which does NOT, because it uses brush-core.

## executeShell (pi-natives) — Fresh Shell, Manual Copy

`executeShell` routes through `crates/pi-natives/src/shell.rs` → `core_execute_shell` in `crates/pi-shell/src/shell.rs`.

In `create_session`:
```rust
let mut shell = BrushShell::builder()
    .do_not_inherit_env(true)  // start clean
    .build()
    .await?;

// Then manually copies std::env::vars()
for (key, value) in std::env::vars() {
    if should_skip_env_var(normalized_key) { continue; }
    // ...set in shell
}
```

**`std::env::vars()` reads the OS process environment at Rust startup.** It does NOT reflect `process.env` mutations from JavaScript after that point. If owp was launched without `KUBECONFIG`, later setting `Bun.env.KUBECONFIG` has no effect on `executeShell`.

## Mise / direnv and tmux

Mise activates via shell hook (e.g., `.bashrc` `eval "$(mise activate bash)"`). Direnv activates via `export` in `.envrc`, evaluated by shell hook.

**tmux creates a new shell** that:
1. Does NOT execute `.bashrc` non-interactively
2. Does NOT see direnv hooks
3. Only sees the env vars that were set when tmux was launched

**Fix:** Inline `eval "$(mise env)"` in the tmux command:
```bash
tmux new-session -d -s owp-debug \
  'cd /repo && eval "$(mise env)" && OWP_DEV=1 ./bin/owp'
```

## Testing Env in tmux

```bash
# Launch owp in tmux, then send a bash command that dumps env
tmux send-keys -t owp-debug '!env | grep -i kube' C-m
tmux capture-pane -t owp-debug -p | tail -10
```

## The owp Bash Tool

When the user sends `!somecommand` in owp, it runs through the same `executeShell` path as `!command` resolution. This means:
- `!echo $KUBECONFIG` shows what `std::env::vars()` captured at startup
- `!KUBECONFIG=/path kubectl ...` works because it's inline in the command string
- `!kubectl --kubeconfig=/path ...` is more reliable than env var approach
