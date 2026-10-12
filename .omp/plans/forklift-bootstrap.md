# Forklift — fork-sync harness (bootstrap + owp dogfood)

## Context

`oh-wiblo-pi` maintains its upstream sync through `.omp/skills/sync-upstream/`: a `sync.ts` runner, a `feature-registry.yaml` that is the single source of truth for fork-owned files, and a `SKILL.md.template` rendered into `SKILL.md` by `generate-skill-md.ts`. That harness is hardcoded to owp — it assumes remotes named `origin`/`upstream`, a `main` branch, `packages/*/src` TypeScript, `bun check:ts`, and a Rust native-addon version sentinel.

The same failure mode (a fork silently losing features on rebase) applies to every other fork in the workspace, and `Deps/` is full of them. This plan extracts the harness into a standalone repo, `../forklift`, that can bootstrap any fork: a portable registry schema, doctor procedures written as exact agent-executable commands, a render pipeline, and a tool-adapter table covering `.pi` and `.omp` (plus `.agents`/`.claude`) skills and commands.

First deliverable is scaffolding plus a live dogfood install into `oh-wiblo-pi` itself, so the extraction is proven on the one instance known to work before any new repo is touched. `../k8s_gateway` is the designated next pilot; the schema is built to satisfy its real shape but `forklift-init` is **not** run against it in this scope.

## Approach

### Phase 0 — Repo scaffold

Create `/var/home/user/Work/forklift/` as a git repo (branch `main`, `LICENSE` = MIT, `.gitignore` ignoring `node_modules/` and `dist/`). Files:

```
forklift/
  README.md                 what it does, install, the three layers
  package.json              name "forklift", type module, bin -> bin/forklift-render
  bin/forklift-render       Bun script, no deps beyond Bun + js-yaml-free parsing
  schema/registry.schema.yaml
  templates/registry.template.yaml
  templates/SKILL.md.tmpl
  skills/forklift-init/SKILL.md
  skills/forklift-doctor/SKILL.md
  skills/sync-upstream/SKILL.md
  adapters/tools.yaml
  docs/portability.md
```

`README.md` states the layer split in one table so a reader knows what is data (registry), what is code (render), and what is judgment (the sync skill).

### Phase 1 — Registry schema (the portable core)

`schema/registry.schema.yaml` defines v1. The registry keeps every field owp's `feature-registry.yaml` already uses — `expected_fork_commit_count`, `features[]` with `name`/`description`/`owned_paths`/`protecting_tests`/`coverage_exempt`/`obsoleted_fixes[]`, `divergences[]`, `removals[]`, `owned_symbols[]` — and adds two new top-level blocks.

**`harness:` (new)** — every repo-specific value that `sync.ts` currently hardcodes, so the checks become config-driven:

| Key | Type | owp value | k8s_gateway value (validated, not used yet) |
|---|---|---|---|
| `version` | int | `1` | `1` |
| `fork.remote` | string | `origin` | `malarinv` |
| `fork.branch` | string | `main` | `master` |
| `upstream.remote` | string | `upstream` | `origin` |
| `upstream.branch` | string | `main` | `master` |
| `project.languages` | string[] | `[typescript, rust]` | `[go]` |
| `project.source_roots` | string[] | `["packages/*/src", "crates/"]` | `["."]` |
| `project.test_globs` | string[] | `["packages/*/test/"]` | `["*_test.go"]` |
| `project.typecheck_command` | string | `bun check:ts` | `go build ./...` |
| `project.test_command` | string | `bun test` | `go test -race ./... -short` |
| `project.lint_command` | string | `bun oxfmt --check . && bun oxlint` | `golangci-lint run --timeout=5m0s` |
| `project.conflict_marker_globs` | string[] | `["packages/**/*.ts", "packages/**/*.rs", "packages/**/*.toml"]` | `["*.go", "**/*.go"]` |
| `project.package_aliases` | map | `{"@oh-my-pi/pi-tui": "packages/tui/src"}` | `{"github.com/k8s-gateway/k8s_gateway": "."}` |
| `checks.behavioral_source_regex` | string | `^packages/[^/]+\/src/.*\.tsx?$` | `.*\.go$` |
| `checks.native_sentinel` | object\|null | `{path_glob: "packages/natives/native/pi_natives.*.node", version_source: "packages/natives/package.json#version", prefix: "__piNativesV"}` | `null` |
| `checks.footprint_baseline` | string | `.forklift/footprint-baseline.json` | same |

Remote names and branch names are data, never assumed — verified across the workspace: owp uses `origin`=fork/`upstream`=upstream, while k8s_gateway uses `malarinv`=fork/`origin`=upstream on branch `master`, and forgejo uses `github`=fork/`origin`=upstream. `checks.native_sentinel` is `null` for non-owp forks, and the doctor must skip that check when null rather than fail.

**`knowledge:` (new)** — free-form project-specific conflict semantics rendered into the sync skill. Holds the decision tree, porting protocol, and gotchas. For owp this is the content currently hardcoded in `SKILL.md.template`.

`templates/registry.template.yaml` is a commented skeleton with every key present and `harness.*` pre-filled with owp's values as the worked example.

### Phase 2 — Render pipeline

`templates/SKILL.md.tmpl` is owp's `SKILL.md.template` generalized: YAML frontmatter with `name: sync-upstream` and a `description` containing the Handlebars-free `{{fork_name}}` / `{{upstream_name}}` substitutions, then the knowledge prose with `{{knowledge}}`, then five GENERATED markers preserved verbatim from owp's template — `feature-stack`, `owned-symbols`, `divergences`, `obsoleted-fixes`, `removals`.

`bin/forklift-render` reads `SKILL.md.tmpl` + a registry path, substitutes, fills the GENERATED markers from the registry, and writes the output path. All substitutions are whole-file replacements; content outside the markers passes through byte-identical, so hand-written prose added to the installed `SKILL.md` survives re-render. Port the escaping rule from owp's generator: `escapeCell` replaces `|`→`\|` and backtick→`'`.

Signature:

```
forklift-render --template <path> --registry <path> --out <path>
```

Exit non-zero with the file/line on an unknown registry key or an unfilled placeholder.

### Phase 3 — Doctor procedures

`skills/forklift-doctor/SKILL.md` states each check as a copy-pasteable command block plus its pass/fail criterion and the exact remediation. No prose describing what to look for. The seven checks, carried over from `sync.ts --verify`:

1. **Registry completeness** — `git log --name-only --format= <upstream>..<fork>` over `harness.project.source_roots`, filtered by `harness.project.test_globs` and `harness.checks` excludes, compared against `features[].owned_paths` + `divergences[]`. Unregistered path → FAIL.
2. **Stale paths** — every registered `owned_paths` entry must `test -e`; missing → FAIL (owp currently has 14 of these).
3. **Feature coverage** — every feature matching `checks.behavioral_source_regex` must have `protecting_tests` or `coverage_exempt`.
4. **Import liveness** — each owned source must have ≥1 importer outside `owned_paths`; resolution uses `harness.project.package_aliases` for prefixed specifiers, and relative-path resolution for others. This is the check that catches a provider that kept its file but lost its `import "./pi"`.
5. **Commit survival** — `git rev-list --count <upstream>..<fork>` equals `expected_fork_commit_count`. A moved count is a symptom, never a diagnosis.
6. **Deletion audit** — every `owned_paths` entry checked against `git cat-file -e <upstream>:<path>`; deleted upstream while still registered → FAIL with the porting protocol.
7. **Version drift** — `.forklift/harness.lock` `harness_version` must equal the installed template's version.

`skills/forklift-init/SKILL.md` covers detection (remotes, default branch, merge-base, languages from `go.mod`/`package.json`/`Cargo.toml`), generating a draft registry from fork commits with `status: draft` on every feature, and running doctor to produce the migration worklist. Draft features make checks 3 and 4 report-and-continue rather than fail.

`skills/sync-upstream/SKILL.md` is the workflow body — rebase, conflict walk, post-sync gate — written against `{{fork_name}}`/`{{upstream_name}}` placeholders with no owp-specific paths.

### Phase 4 — Tool adapters

`adapters/tools.yaml` declares, per tool: `skills_dirs` (project-scoped), `commands_dir`, `commands_namespace` (`""` or `opsx`), `commands_ext`, and `invocation`:

```yaml
tools:
  - id: pi
    skills_dirs: [".pi/agent/skills", ".pi/skills"]
    commands_dir: ".pi/commands"
    invocation: "/{name}"
  - id: omp
    skills_dirs: [".omp/skills"]
    commands_dir: ".omp/commands"
    invocation: "/{name}"
  - id: agents
    skills_dirs: [".agents/skills"]
    invocation: "/{name}"
  - id: claude
    skills_dirs: [".claude/skills"]
    commands_dir: ".claude/commands/opsx"
    commands_namespace: opsx
    invocation: "/opsx:{name}"
```

These paths are confirmed from owp's own discovery code, not guessed: `packages/coding-agent/src/discovery/pi.ts:483,499` declares `.pi/agent/skills/*/SKILL.md`, `.pi/skills/*/SKILL.md`, `.pi/agent/commands/*.md`, `.pi/commands/*.md`; `discovery/builtin.ts:283,344` walks ancestors for `.omp/skills/` and loads `<configdir>/commands`. Only `.omp` and `.claude` get command files; `.pi` and `.agents` are skills-only in v1.

Install writes `<skills_dir>/sync-upstream/SKILL.md` into every declared `skills_dirs` entry, and `<commands_dir>/sync-upstream.md` with `---\ndescription: <one line>\n---` frontmatter. Note owp's existing `.omp/commands/sync-upstream.md` has no frontmatter and still loads; writing frontmatter is additive and safe.

Every generated file starts with a stamp line `<!-- forklift v<version> -->`; `forklift-doctor` check 7 compares it against `harness.lock` and reports drift.

### Phase 5 — Dogfood on owp

Install into `/var/home/user/Work/oh-wiblo-pi`:

1. Create `.forklift/registry.yaml` from `.omp/skills/sync-upstream/feature-registry.yaml`, adding the `harness:` block with owp's real values and moving the template's prose into `knowledge:`.
2. Run `forklift-render` against the new registry and template.
3. **Preserve `sync.ts` unchanged.** It reads `.omp/skills/sync-upstream/feature-registry.yaml`; that path must keep working in this phase. Generate it as a rendered copy of `.forklift/registry.yaml` (front-matter comment noting it is generated, do not edit) so the two cannot diverge.
4. Write `.forklift/harness.lock` with `harness_version: 1` and the registry's `generatedAt`.
5. Copy `.forklift/footprint-baseline.json` from `.omp/skills/sync-upstream/footprint-baseline.json` unchanged and point `checks.footprint_baseline` at the new path.

The rendered `.omp/skills/sync-upstream/SKILL.md` must contain all five GENERATED sections with the same row counts as the current generated file.

## Critical files & anchors

- `/var/home/user/Work/oh-wiblo-pi/.omp/skills/sync-upstream/SKILL.md.template` — source of the generalized template; its five `<!-- GENERATED:* -->` markers and the decision tree prose are what move into `templates/SKILL.md.tmpl` and `knowledge:`.
- `/var/home/user/Work/oh-wiblo-pi/.omp/skills/sync-upstream/generate-skill-md.ts` — the render logic being generalized; `escapeCell` (line ~150) and the five `generate*` functions are ported verbatim, `loadRegistry`/`SKILL_MD`/`REGISTRY`/`ROOT` constants become CLI flags.
- `/var/home/user/Work/oh-wiblo-pi/.omp/skills/sync-upstream/sync.ts:645-680,754,886-908` — the hardcoded values that become `harness.*`: `resolveRepoPath` prefix list, `BEHAVIOR_SOURCE`, `bun check:ts`, the native-sentinel block.
- `/var/home/user/Work/oh-wiblo-pi/.omp/skills/sync-upstream/feature-registry.yaml:1-25` — the header comment documents `expected_fork_commit_count`, `obsoleted_fixes`, `protecting_tests`, and `coverage_exempt` semantics; those become the schema field docs.
- `/var/home/user/Work/oh-wiblo-pi/packages/coding-agent/src/discovery/pi.ts:483,499` and `discovery/builtin.ts:283,344` — authoritative `.pi`/`.omp` skills and commands paths.

## Verification

Run from `/var/home/user/Work/oh-wiblo-pi` unless stated.

1. **Render is byte-stable.** `cp .omp/skills/sync-upstream/SKILL.md /tmp/before.md`, run `forklift-render` into `/tmp/after.md`, then `diff /tmp/before.md /tmp/after.md`. Expected: differences only in the `{{fork_name}}`-substituted prose and the fork-doc line; the five GENERATED tables identical. If the tables differ at all, the generator port is wrong — fix before proceeding.
2. **Registry survives migration.** `bun -e 'const r=await Bun.YAML.parse(await Bun.file(".omp/skills/sync-upstream/feature-registry.yaml").text()); console.log(r.features.length, r.divergences.length, r.removals?.length ?? 0)'` before and after. Expected: identical counts (record the exact numbers first).
3. **sync.ts still works.** `bun .omp/skills/sync-upstream/sync.ts --dry-run`. Expected: exit 0 and the same pre-flight output as before the migration — in particular no "Unregistered file in fork commit" errors, which proves the generated registry copy is complete.
4. **Doctor runs against real drift.** Execute `skills/forklift-doctor/SKILL.md` check 2 (stale paths) on owp. Expected: reports the 14 known-stale `owned_paths` entries. A doctor that reports zero here is wrong, not good — it means the check is not reading the registry.
5. **New-behavior check — inverted remotes resolve.** Create a scratch registry outside any repo at `/tmp/flip/registry.yaml` whose `harness` block names `fork.remote: malarinv`, `fork.branch: master`, `upstream.remote: origin`, `upstream.branch: master`, `project.typecheck_command: go build ./...`. Run `forklift-render --registry /tmp/flip/registry.yaml`. Expected: rendered output names `master` (never `main`) in every rebase instruction and contains no `bun check:ts` string. This is the check that would have failed against k8s_gateway under owp's hardcoded assumptions.
6. **Adapter install is idempotent.** Run the install twice into `/tmp/flip/` for `pi` and `omp`. Expected: after the second run, `.pi/agent/skills/sync-upstream/SKILL.md`, `.pi/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/SKILL.md`, `.omp/commands/sync-upstream.md` all exist and `diff` reports no change from the first run.
7. **Drift detection fires.** Edit the stamp line in `/tmp/flip/.omp/skills/sync-upstream/SKILL.md` to `<!-- forklift v0 -->`. Expected: doctor check 7 FAILs naming the expected and actual versions.

## Assumptions & contingencies

- **owp's `feature-registry.yaml` stays valid input.** If its YAML has constructs the renderer mishandles, fix the renderer; do not hand-edit the registry to make it render.
- **`sync.ts` is not modified.** If it turns out to require the `harness:` block to run, that is a Phase-6 change — stop and report rather than editing `sync.ts` under this plan.
- **Stale paths are expected, not a blocker.** owp has 14 registered paths that no longer exist. The doctor must report them; do not delete them from the registry during this plan, since some may be intentional (a ported-away module). If the count is not 14, report the actual number rather than reconciling it.
- **`knowledge:` splitting is editorial.** Where owp's template prose belongs in `knowledge:` versus staying in the generic template is a judgment call; default to `knowledge:` for anything mentioning owp, `oh-my-pi`, `packages/`, `crates/`, `bun `, or `hashline`.
- **Blocky is not a fork** (0/0 divergence, single branch, no upstream remote) and **forgejo is branch-based** (1144 behind / 146 ahead across 4 feature branches), so neither validates this schema. If asked to add either, the correct answer is that `harness.fork`/`harness.upstream` alone cannot express forgejo's model.
- **No binary in this scope.** Whether the checks graduate to an executable is decided after the k8s_gateway pilot by measuring which procedures were slow or produced wrong answers — not decided now.