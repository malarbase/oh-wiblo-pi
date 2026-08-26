---
name: tmux-debug
description: Debug interactive TUI applications (like owp) using tmux. Launch, interact, capture output, and inspect logs without blocking the terminal.
---

# Tmux Debug Skill

Debug interactive TUI tools by running them in a detached tmux session and scripting interactions.

## Quick Start

```bash
# Launch owp in a detached tmux session
tmux new-session -d -s owp-debug 'cd /path/to/repo && OWP_DEV=1 ./bin/owp'

# Wait for startup, then send a command
tmux send-keys -t owp-debug '/refresh-models MyProvider' C-m

# Capture the visible output
tmux capture-pane -t owp-debug -p | tail -20

# Kill when done
tmux kill-session -t owp-debug
```

## Session Lifecycle

| Action | Command |
| ------ | ------- |
| Create | `tmux new-session -d -s <name> '<command>'` |
| List | `tmux ls` |
| Send keys | `tmux send-keys -t <name> '<text>' C-m` |
| Capture | `tmux capture-pane -t <name> -p \| tail -N` |
| Kill | `tmux kill-session -t <name>` |

**Always kill the session when done** to avoid stale processes.

## Common Patterns

### Reproduce a slash command issue

```bash
tmux kill-session -t owp-debug 2>/dev/null
sleep 1
tmux new-session -d -s owp-debug 'cd /var/home/user/Work/oh-wiblo-pi && OWP_DEV=1 ./bin/owp'
sleep 4  # wait for startup
tmux send-keys -t owp-debug '/refresh-models NeuralWatts' C-m
sleep 6  # wait for network
tmux capture-pane -t owp-debug -p | tail -15
```

### Check logs after a command

```bash
# owp logs to ~/.omp/logs/omp.YYYY-MM-DD.log
cat ~/.omp/logs/omp.$(date +%Y-%m-%d).log | grep -i "provider\|discover\|error" | tail -20
```

### Add temporary debug logging

Insert `logger.debug("...", { ... })` or `logger.warn("...", { ... })` in the code path, then relaunch the tmux session. Remove the logging after debugging.

### Iterative debug loop

```bash
# 1. Edit code
# 2. Kill old session and relaunch
tmux kill-session -t owp-debug 2>/dev/null; sleep 1; tmux new-session -d -s owp-debug 'cd /path/to/repo && OWP_DEV=1 ./bin/owp'
# 3. Send command and capture
tmux send-keys -t owp-debug '/your-command' C-m && sleep 5 && tmux capture-pane -t owp-debug -p | tail -20
```
### Services with mise-managed tools (e.g. `bun: not found`)

When the wrapper script or binary requires a mise-managed tool (bun, node, zig), tmux
sessions do not inherit mise shell hooks. The command will fail with `not found`:

```bash
./bin/owp --help   # → bun: not found
```

Fix by evaluating mise env inside the tmux command:

```bash
tmux new-session -d -s owp-debug \
  'cd /var/home/user/Work/oh-wiblo-pi && eval "$(mise env)" && ./bin/owp'
```

Or upgrade the tool globally so the wrapper script works everywhere:

```bash
mise use bun@1.3.14   # pins in mise.toml; activates via shim
```

## Debugging Checklist

1. **Reproduce in tmux** — confirm the issue is real, not a local terminal artifact
2. **Add targeted logging** — log inputs/outputs at the boundary (API calls, auth checks)
3. **Check logs** — `~/.omp/logs/omp.YYYY-MM-DD.log` for backend errors
4. **Capture pane output** — verify TUI state matches expectations
5. **Fix and re-test** — iterate in tmux until resolved
6. **Clean up** — remove debug logging, kill tmux session

## Anti-patterns

- **Don't** run `owp` directly in your terminal while debugging — it blocks and corrupts the TUI on crashes
- **Don't** leave tmux sessions running — they consume resources and may conflict with new launches
- **Don't** commit debug logging — remove before submitting
