---
name: agent-modes
description: Reference for omp run modes and bundled sub-agents. Use when choosing how to launch omp, which sub-agent to spawn, or how to embed omp in another tool.
---

# omp Agent Modes

Two orthogonal dimensions: **how omp runs** (run mode) and **which agent persona handles the task** (sub-agent).

---

## Run Modes

Controlled via `--mode` / `-p` flags.

| Mode | Flag | Use When |
|---|---|---|
| **Interactive** | *(default)* | Human-in-the-loop, TUI sessions |
| **Print** | `-p` / `--print` | Scripting: pipe prompt in, get text out, process exits |
| **JSON** | `--mode json` | Scripting with structured event stream (sessions, tool calls, tokens) |
| **RPC** | `--mode rpc` | Embedding omp in another app; full bidirectional control over stdin/stdout |

### Interactive (default)
Full TUI. Supports `--continue` (`-c`) to resume last session and `--resume` (`-r`) to pick a specific session. Press `Ctrl+P` to cycle models.

### Print mode
```bash
omp -p "Summarize the last 5 commits"
echo "What does this do?" | omp -p @main.rs
```
Outputs final assistant text to stdout, then exits. Combine with `--model` for lightweight scripting.

### JSON mode
```bash
omp --mode json -p "Run tests and report failures"
```
Emits a JSONL event stream: session header, tool calls, assistant tokens, completion. Useful for CI pipelines or log ingestion.

### RPC mode
```bash
omp --mode rpc
```
Headless server. Receives `RpcCommand` JSON on stdin, emits events and `RpcResponse` JSON on stdout. Used by editor extensions (Cursor, VS Code) and the swarm extension. Key commands: `prompt`, `abort`, `get_state`, `set_model`, `compact`, `bash`.

---

## Bundled Sub-Agents

Spawnable from within a session. Agents are defined in `packages/coding-agent/src/prompts/agents/` and can be unpacked with `omp agents unpack`.

Spawn via `@agent-name` in the prompt, or through the `spawn_agent` tool.

### `task` — Worker
**Full tool access. Hyperfocused. No TUI.**

The default delegate for implementation work. Given an assignment, it completes it and returns a terse result. Does not deviate from scope.

```
When to use: Any concrete implementation unit that can be delegated.
Model: inherits caller
Tools: all
```

### `plan` — Architect
**Read-only investigation → written plan.**

For complex multi-file decisions where you need an upfront design before touching code. Spawns `explore` for research. Writes a plan document, does not implement.

```
When to use: Refactors touching 5+ files, new subsystem design, unclear dependency graph.
Model: pi/slow (or gpt-5.2, codex)
Tools: read, grep, find, bash, lsp, fetch, web_search, ast_grep
Spawns: explore
```

<caution>
NOT for single-file changes or tasks completable in <5 tool calls. Over-planning is waste.
</caution>

### `explore` — Scout
**Fast, read-only, returns structured output.**

Rapid codebase investigation. Returns `{ summary, files[], architecture }` for handoff to another agent. Uses `pi/smol` — finishes in seconds.

```
When to use: "Where is X defined?", "What calls Y?", pre-implementation reconnaissance.
Model: pi/smol
Tools: read, grep, find, fetch, web_search
Thinking: medium
Output: structured JSON (summary, files with refs, architecture)
```

### `reviewer` — Code Reviewer
**Security + quality analysis. Returns structured findings.**

Read-only review specialist. Spawns `explore` and `task` for deeper investigation. Uses `report_finding` tool to emit structured findings.

```
When to use: Pre-merge review, security audit, quality pass.
Model: inherits / pi/slow
Tools: read, grep, find, bash, lsp, fetch, web_search, ast_grep, report_finding
Spawns: explore, task
```

### `oracle` — Diagnostician
**Deep reasoning. Read-only. Blocking.**

Senior advisor for situations where the primary agent is stuck: doom loops, mysterious failures, hard architectural calls. Uses `pi/slow` + high thinking. Blocks until it returns a verdict.

```
When to use: Stuck >2 iterations. Architecture decision with real tradeoffs. Root-cause unknown.
Model: pi/slow
Thinking: high
Tools: read, grep, find, bash, lsp, fetch, web_search, ast_grep
Spawns: explore
Blocking: true
```

Output structure: **Diagnosis** → **Evidence** → **Recommendation** (→ Caveats, Risks when relevant).

### `librarian` — Library Researcher
**Source-verified answers on external libraries and APIs.**

Reads actual library source and docs rather than relying on training data. Returns definitive, citable answers.

```
When to use: "How does X work in library Y?", API surface questions, version-specific behavior.
Model: pi/smol
Tools: read, grep, find, bash, lsp, web_search, fetch, ast_grep
```

### `designer` — UI/UX Specialist
**Design implementation, review, and visual refinement.**

Prefers Gemini (strong visual reasoning). Spawns `explore` for codebase context before touching UI code.

```
When to use: Component design, visual review, CSS/layout decisions.
Model: google-gemini-cli/gemini-3-pro (fallback: gemini-3, pi/default)
Spawns: explore
```

### `init` — AGENTS.md Generator
**One-shot: generates AGENTS.md for the current codebase.**

Scans the project and produces a well-structured AGENTS.md describing architecture, conventions, and agent guidance. Run once when setting up a new project.

```
When to use: New repo, or AGENTS.md is stale / missing.
Thinking: medium
```

---

## Choosing a Sub-Agent

```
Need to implement something?          → task
Need to understand before acting?     → explore → then task/plan
Multi-file architecture decision?     → plan
Stuck / doom loop / mysterious bug?   → oracle
Library/API question?                 → librarian
Pre-merge quality check?              → reviewer
UI/design work?                       → designer
Setting up a new project?             → init
```

---

## Model Slots

omp resolves three model roles at startup, overridable per-flag or env var:

| Slot | Flag | Env | Used By |
|---|---|---|---|
| Default | `--model` | `PI_MODEL` | Main agent, `task` |
| Smol | `--smol` | `PI_SMOL_MODEL` | `explore`, `librarian` |
| Slow | `--slow` | `PI_SLOW_MODEL` | `oracle`, `plan` |
| Plan | `--plan` | `PI_PLAN_MODEL` | `plan` (if distinct from slow) |

`pi/smol`, `pi/slow`, `pi/default` are resolved at runtime from `~/.omp/agent/models.yml`.
