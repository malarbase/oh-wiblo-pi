# Maintaining oh-wiblo-pi (owp): Living Rebase Fork of oh-my-pi (omp)

This document describes the fork maintenance strategy for **oh-wiblo-pi** as a permanent rebase fork of **oh-my-pi**. It complements `docs/porting-from-pi-mono.md` (which governs omp's relationship with pi-mono) by defining owp's relationship with omp.

## Philosophy

**owp = omp + feature stack.** The fork's `main` branch is a linear sequence of feature commits stacked on top of `upstream/main` (omp's main). Every omp update is pulled via rebase, with LLM agents handling trivial conflicts and escalating semantic changes.

The goal: use all your features, always on the latest omp, with minimal maintenance friction.

---

## Branch Structure

```
upstream/main (omp)      ─────────────────► (17 commits/day, ~528/month)
                                           ▲
fork/main (owp)          upstream/main
                         + [identity]
                         + [ask/debug]
                         + [skill grouping]
                         + [future...]       ◄── PR targets here
                                            ▲
feature branch           upstream/main
                         + [new feature]     ◄── rebase against upstream, PR to fork/main
```

**Key rule:** `fork/main` is always `upstream/main` + a linear stack of squashed feature commits. No merge commits. Each feature is one clean commit.

---

## Last Sync Point

**Upstream base:** `05f50a6a7` (Merge pull request #623 from apoc/fix/notification-inject-on-receive)
**Date:** 2026-04-26
**omp commits since:** 0

To generate patches for your next sync:
```bash
git format-patch 05f50a6a7..upstream/main
```

Update this section after each successful rebase.

---

## Fork Features (Curated Stack)

| Commit | Feature | Owned Files | Status |
|--------|---------|------------|--------|
| `bb2efea` | Identity (README) | `README.md` | docs only |
| `91b9b52` | Ask/Debug mode | `src/modes/ask-mode/`, `src/modes/debug-mode/`, `src/session/agent-session.ts`, `src/slash-commands/builtin-registry.ts`, `src/prompts/system/ask-mode-context.md`, `src/prompts/system/debug-mode-context.md` | code |
| `23278c1` | Skill grouping + two-level scan + `!command` baseUrl + `openai-compatible` discovery | `src/modes/components/extensions/`, `src/config/model-registry.ts`, `src/discovery/helpers.ts`, `src/discovery/pi.ts`, `src/capability/skill.ts` | code |
| `98bcebd` | sync-upstream skill and script | `.omp/skills/sync-upstream/` | tooling |
| `0d8a054` | Fix plugin installer path + symlink injection | `packages/coding-agent/src/installer.ts` | bug fix |
| `7e02487` | Cast node Blob to Web Blob for tsgo | `packages/utils/src/streams.ts` | bug fix |
| `7cde66c` | Send mode-off context message on disable | `src/modes/ask-mode/`, `src/modes/debug-mode/` | bug fix |
| `eac4e6d` | Add mise.toml with zig; document native rebuild in sync process | `mise.toml`, `.omp/skills/sync-upstream/SKILL.md`, `.omp/commands/sync-upstream.md` | tooling |
| `3d814f6` | Thread disabledExtensions into skillsSettings | `src/sdk.ts` | bug fix |
| `aa5ee1a` | Archive skill-group-toggle openspec spec | `openspec/specs/skill-group-toggle/spec.md` | tooling |
| `4498305` | Unified agent mode cycle keybinding (alt+m) | `src/modes/components/status-line/`, `src/config/settings-schema.ts` | code |
| `622e948` | Load slash commands from prompts/ not commands/ | `src/session/agent-session.ts` | bug fix |
| `1b256ca` | Rediscover skills on /new after ECC toggles | `src/sdk.ts`, `src/capability/skill.ts` | code |
| `fc0cf73` | Work around zlob/zig build failure on macOS 26 | `crates/pi-natives/` | bug fix |
| `75be25d` | session_directory event, jiti extension loader, authHeader fix | `src/sdk.ts`, `src/session/`, `src/capability/`, `src/extensibility/extensions/loader.ts` | code |
| `5dfe001` | feature-checklist extension, rebase docs, owned symbols registry, SHARED_FILES note | `docs/maintaining-owp-fork.md`, `.omp/skills/sync-upstream/SKILL.md`, `.omp/extensions/feature-checklist.ts`, `src/sdk.ts` | code |
| `608e6f5` | Add /refresh-models slash command | `src/slash-commands/builtin-registry.ts` | code |
| `4392f86` | Track cache write tokens via LiteLLM passthrough fields; add bin/owp switcher | `packages/ai/src/providers/openai-completions.ts`, `bin/owp`, `mise.toml`, `docs/cache-token-tracking.md` | code |
| `6455aed` | Add .gitnexus, .claude/, CLAUDE.md to .gitignore | `.gitignore` | chore |
| `f782a49` | Use jiti with virtualModules in custom command loader | `packages/coding-agent/src/extensibility/custom-commands/loader.ts` | bug fix |
| `eee523d` | Build dist/owp as primary output, keep dist/omp in sync | `packages/coding-agent/scripts/build-binary.ts` | bug fix |
| `6346716` | Fix isBunBinary evaluating to false in compiled binary | `packages/coding-agent/src/config.ts` | bug fix |

> **Note:** Commit hashes change on every rebase. Update this table after each sync.

## Owned Symbols in Shared Files

The sync-upstream skill (`.omp/skills/sync-upstream/SKILL.md § Owned Symbols`) maintains the
authoritative symbol-level ownership registry. During rebase, conflicts in shared files must
preserve these specific symbols rather than taking wholesale blocks.

The most conflict-prone file is `sdk.ts`. OWP owns these symbols inside it:
- `makeSkillDiscoverer()` — skill rediscovery factory
- `skillsOverride` param in `rebuildSystemPrompt` — allows override on /new
- `disabledExtensions` spread in `skillsSettings` — threads ECC toggles
- `let sessionManager` — allows session_directory handler override
- `customPrompt: options.systemPrompt` — custom prompt in string-typed branch only

---

## Upstream Bug Fixes (Pending Upstream PR)

Bugs fixed in owp that also exist in omp. These commits should be upstreamed. During sync, if upstream fixes the same bug differently, prefer upstream and drop our commit.

| Commit | Bug | Upstream status |
|--------|-----|-----------------|
| `b396419d1` | `installer.ts` uses `getAgentDir()` instead of `getPluginsDir()`, causing all plugin install/uninstall to operate on `~/.omp/agent/plugins` instead of `~/.omp/plugins`. Also adds `@oh-my-pi/*` / `@mariozechner/*` symlink injection so plugins can import either package name. | Not filed |

When filing upstream, note: the `getAgentDir()` vs `getPluginsDir()` bug is latent in omp too (both resolve to `~/.omp/plugins` on stock omp since `agentDir == ~/.omp`), but becomes visible in owp where `agentDir == ~/.omp/agent`. The symlink injection fix is owp-specific (package rename `@mariozechner/*` → `@oh-my-pi/*`).


---

## Sync Workflow

Use `.omp/commands/sync-upstream.md` to trigger the sync (LLM agent or manual).

### Step 1: Fetch and rebase

```bash
git fetch upstream
git checkout main
git rebase upstream/main
```

During rebase, the agent resolves conflicts using the decision tree below.

### Step 2: Rebuild native addon if needed

If upstream changed anything under `packages/natives/` or `crates/`, the native addon must be rebuilt before omp will work:

```bash
git diff --name-only HEAD@{1} HEAD | grep -qE '^(packages/natives|crates)/' && mise exec -- bun --cwd=packages/natives run build
```

If omp fails to start with `Failed to load pi_natives native addon ... Missing: <symbol>`, run the build unconditionally:

```bash
mise exec -- bun --cwd=packages/natives run build
```

Native dependencies (e.g. `zig` for MiMalloc/zlob) are managed via `mise.toml` — run `mise install` once if the build fails due to a missing tool.

### Step 3: Verify compilation

```bash
bun check:ts
```

If type errors, the agent escalates rather than pushing.

### Step 4: Verify config compatibility

After the code changes, verify your local omp config is still valid against the new schema:

```bash
omp --validate-config 2>/dev/null || omp --help > /dev/null
```

Or simply start omp and check for schema errors in the startup output. If you see:

```
Failed to load config file models, Schema error: ...
```

The schema for `~/.omp/agent/models.yml` changed upstream. Common cases:

- A `discovery.type` value you configured is no longer valid (or was never valid) — check the current allowed values in `src/config/model-registry.ts` → `ProviderDiscoverySchema`
- A new required field was added to a provider config

Fix `~/.omp/agent/models.yml` to match the current schema before proceeding.

### Step 5: Force-push (with safety)

```bash
git push origin main --force-with-lease
```

This atomically updates `fork/main` and resets any open feature branches' merge bases.

---

## Conflict Resolution Decision Tree

When `git rebase` hits a conflict, the agent applies this logic:

```
Is the file in "Owned Files" (§ Fork Features)?
  → YES: Prefer ours, verify compilation
  → NO: Continue below

Is the conflicting hunk inside a shared file with owp-owned symbols (§ Owned Symbols)?
  → YES: Take upstream's structure, graft in owp-owned symbols, verify all survive
  → NO: Continue below

Is upstream's change a rename/refactor of something we depend on?
  → YES: Adapt ours to the new shape, verify compilation
  → NO: Continue below

Is upstream's change altering the *semantics* of an interface we depend on?
  (E.g., changing return type contract, removing a mode, restructuring data flow)
  → YES: Escalate to user ("upstream changed X; your feature Y depends on it—adapt or drop?")
  → NO: Continue below

Is the file in "Skip These Upstream Features" (§15 in porting-from-pi-mono.md)?
  → YES: Prefer upstream (we don't own it)
  → NO: Prefer upstream (benefit from upstream's work)

Result: Take upstream, verify compilation
```

### Examples

**Trivial (auto-resolve):**
- Upstream renames a utility function we call → update call site, compile
- Upstream adds a new field to a shared type we inherit from → update our consumer, compile
- Upstream reformats an unrelated file → prefer upstream
- Upstream adds a feature in a file we don't touch → prefer upstream

**Semantic (escalate to user):**
- Upstream rewrites `scanSkillsFromDir(...)` to return a different contract, incompatible with our skill grouping feature
- Upstream removes the `extensibility` system we depend on for ask/debug mode
- Upstream changes the semantics of "disabled extensions" in a way that breaks our group toggle

---

## Implementing New Features

### Design for rebase survival

Features that own their own files rebase cleanly. Features that scatter inline code through
`sdk.ts` conflict on every sync. Before implementing:

- **Put logic in new files** under `src/modes/`, `src/config/`, or `src/capability/`.
  Import and call from the minimum number of shared callsites.
- **Minimize sdk.ts surface.** One import + one constructor arg = one conflict hunk.
  Six scattered additions = six conflict hunks.
- **Extend shared types, don't fork them.** Add literals to existing unions rather than
  creating parallel types.
- **Use extension hooks** when they exist (event handlers, extensionRunner).
- **Update the symbol registry** in `.omp/skills/sync-upstream/SKILL.md` in the same commit
  that touches shared files.

### Git workflow

1. Create a feature branch off upstream/main:
   ```bash
   git fetch upstream
   git checkout -b feat/my-feature upstream/main
   # ... implement
   git push origin feat/my-feature
   ```

2. Open a PR to fork/main. Merge strategy: **squash**.

3. After merge, update this doc (Fork Features table) with:
   - The commit hash, feature name, owned files, status
   - The interfaces/capabilities it depends on

4. Audit the contact surface:
   - How many hunks does this commit add to sdk.ts?
   - What shared-file symbols does it own? (add to SKILL.md § Owned Symbols)

---

## Handling Open PRs During Sync

If you have open feature branches:

1. The rebase of `fork/main` doesn't touch them initially
2. After `fork/main` is updated, each feature branch's merge base moves
3. The agent or you can rebase the feature branch against the new `upstream/main`:
   ```bash
   git rebase upstream/main feat/my-next-feature
   ```

This is independent of the `fork/main` rebase — no conflicts propagate.

---

## Keeping Identity Safe

The identity commit (`daf000ce9`, README fork marker) must survive every rebase. It owns `README.md` only.

**If upstream changes README:**
- Rebase conflict on README
- Agent takes upstream version, then cherry-picks the identity commit's README changes back on top
- Or: agent takes ours, then manually syncs any substantial upstream README changes
- Document the choice in the commit message

---

## What If a Feature Breaks After Sync?

If `bun check:ts` fails after rebase:

1. The agent does not push
2. The agent either:
   - Fixes the conflict and re-checks (if it's a trivial shape mismatch), or
   - Escalates to you with the error and the conflicted files

3. You resolve the issue, verify `bun check:ts` again, then manually push:
   ```bash
   git push origin main --force-with-lease
   ```

---

## Sync Frequency

Recommend weekly syncs or before each feature launch. omp moves fast (~17 commits/day), so waiting >2 weeks risks larger conflict surface.

Monitor upstream for major refactors or breaking changes in your owned files/interfaces. The porting doc `§15` helps the agent recognize these.

---

## Rollback

If a sync goes wrong:

```bash
git reset --hard origin/main@{1}   # revert to pre-rebase state
git push origin main --force-with-lease
```

The feature branches are unaffected; they still have their old merge base. Re-run the sync when ready.

---

## Reference: omp Intentional Divergences

From `docs/porting-from-pi-mono.md §15`. **owp should not override these** during sync:

- `StatusLineComponent` instead of `FooterDataProvider`
- `.omp/` namespace instead of `.pi/`
- Multi-credential auth with round-robin instead of single-credential
- Capability-based discovery system
- MCP/Exa/SSH integrations
- LSP writethrough
- Bash interception

If upstream changes one of these, escalate to user.

---

## Monitoring & Escalation Checklist

**Before sync:**
- [ ] Check upstream's recent commits for changes to your owned files
- [ ] Read any recent CHANGELOG entries in omp for breaking changes

**During sync:**
- [ ] Agent logs all conflicts and resolutions
- [ ] If `packages/natives/` or `crates/` changed: rebuild native addon (`mise exec -- bun --cwd=packages/natives run build`)
- [ ] After conflict resolution: `grep -rn '<<<<<<' packages/` returns no results
- [ ] After conflict resolution: `bunx tsgo -p tsconfig.json --noEmit` has no NEW errors
- [ ] After conflict resolution: all owp-owned symbols verified present (see § Owned Symbols)
- [ ] If owp deps were added: `bun install` run and bun.lock committed
- [ ] Type check passes before push
- [ ] Identity commit still present on main

---

## Asking for Help

If the sync agent escalates:

1. Read the escalation message and conflicted files
2. Decide: adapt your feature or drop the upstream change?
3. Resolve manually, then push

If stuck, refer to:
- Your feature's commit message (describes intent and dependencies)
- This doc's decision tree
- `docs/porting-from-pi-mono.md` for omp's own policies
