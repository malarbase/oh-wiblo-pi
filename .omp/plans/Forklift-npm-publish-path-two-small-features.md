# Forklift: npm publish path + two small features

## Context

Forklift (`/var/home/user/Work/forklift`) is a Bun-only harness (`bin/forklift-render`, `bin/forklift-install`, `bin/forklift-doctor`) that manages fork repos for agent sync. It currently exists only as a local checkout; forks call it by absolute path (`bun "$FORKLIFT/bin/forklift-doctor"`). Goal: ship it as `@whiteblossom/forklift` on the Whiteblossom Forgejo npm registry so any fork runs `npx --yes @whiteblossom/forklift@X doctor`, with the platform governance (catalog archetype, supply-chain policy, scaffolder template) extended to cover an npm-publishing `tool` repo. In scope additionally: the two small forklift features from `docs/todo` — `AGENT.md` generation and the antigravity tool adapter. Out of scope: compiled platform-binary packages, Rust/Go import-liveness analyzers, `go.mod` replace checks, crate-scoped harness.

## Approach

Steps are ordered so each leaves every repo green. Steps 2–6 are forklift-side and independent of platform repos; step 7 must land before step 9's workflow is pushed (the compliance gate runs `supply_chain.rego` over `.forgejo/workflows/*.yaml` on every push); step 8 must land before step 9 (Forgejo Actions only runs on a hosted repo).

### 1. Commit the k8s_gateway dogfood (user-approved)

Working dir `/var/home/user/Work/k8s_gateway`. Current checkout is `fix/loopback-source-ip-clusterip-fallback`, whose content equals `master` (both are `f40e005` after the earlier push `34ff94d..f40e005 → master`). `git switch master` first. `git add .forklift .omp && git commit -m "chore(k8s-gateway): add forklift harness — registry, rendered skills" && git push malarinv master`. Do not delete the local fix branch. Both check-5 ranges were measured at 18 before this commit; step 5 rebaselines.

### 2. Unify the CLI into one `forklift` binary

Move each bin's body into a module, delete the three bins, add a dispatcher. Flag names, defaults, exit codes (0 ok, 1 validation/registry failure, 2 usage) and all console output stay byte-identical — installed skills and fork docs embed these commands.

- New `lib/commands/render.ts`, `lib/commands/install.ts`, `lib/commands/doctor.ts`: verbatim body moves from `bin/forklift-render`, `bin/forklift-install`, `bin/forklift-doctor`. Each exports `export const HELP: string[]` (render/install already have a `HELP` const; doctor has `HELP` as a template string — convert to the same array shape) and `export async function run(argv: string[]): Promise<void>`, where `argv` is the flag slice only. Each module keeps its own `process.exit` calls.
- **Root-derivation fixes (load-bearing):** every `path.resolve(import.meta.dir, "..")` becomes `"../.."`. Concretely: `bin/forklift-install:37` (`const FORKLIFT`); `bin/forklift-doctor:298` (`forkliftRoot = process.env.FORKLIFT || path.resolve(import.meta.dir, "..")`), `:365` (`SCHEMA_PATH`), `:384` (dynamic `import(... "lib", "registry.ts")` — becomes `"..", "lib", "registry.ts"`); `bin/forklift-render:30-33` (`HERE`, `DEFAULT_TEMPLATE`, `DEFAULT_SCHEMA`, `TOOLS_YAML`). Check 7 reads the schema and `adapters/tools.yaml` through these paths, so a wrong depth silently disables the stamp scan.
- New `bin/forklift`: `#!/usr/bin/env bun`; parse `process.argv.slice(2)`; dispatch table `{ render, install, doctor }` importing the three modules statically; `--help`/`-h` prints usage plus each subcommand's `HELP` lines; `--version` prints the `version` field of `package.json` read via `Bun.file(path.resolve(import.meta.dir, "../package.json"))`; unknown/missing subcommand prints usage to stderr and exits 2. Each module is imported lazily only for its subcommand? No — static top-level imports; the whole CLI is one Bun process.
- Delete `bin/forklift-render`, `bin/forklift-install`, `bin/forklift-doctor`.
- `package.json`: `"bin": { "forklift": "bin/forklift" }`; `"scripts": { "doctor": "bun bin/forklift doctor", "render": "bun bin/forklift render", "install-skills": "bun bin/forklift install" }`.
- Rewrite every callsite (grep `forklift-(render|install|doctor)`): `README.md` (three-layer table row, install snippet, workflow section), `docs/portability.md` (portability table, steps 3 and 5), `skills/forklift-init/SKILL.md` (runnable-probe snippet, step 4 commands, prose), `skills/forklift-doctor/SKILL.md` (intro, setup paragraph, usage block), `templates/sync-upstream.md` (post-rebase step), `templates/SKILL.md.tmpl` (regenerate-generated-docs line), `templates/registry.template.yaml` (regeneration comment), `adapters/tools.yaml` (header comment), `schema/registry.schema.yaml` (consumer list in header). New command text everywhere: `bun bin/forklift doctor`, `bun bin/forklift render --registry <repo>/.forklift/registry.yaml`, `bun bin/forklift install --target <repo>`.

### 3. `AGENT.md` generation, on by default

`forklift render` writes `<repo>/AGENT.md` by default, mirroring how it already writes `SKILL.md` unconditionally; `--no-agent-md` opts out. The opt-out flag is the only flag this adds (no positive `--agent-md`).

`fillTemplate` (lib/registry.ts) supports only `{{var}}` and `{{#if name}}` — no `{{#each}}`. Loops therefore cannot live in template prose; the variable sections are generated in code, exactly like the five `<!-- GENERATED:* -->` tables in render.

- New `templates/AGENT.md.tmpl`: prose with `{{fork_name}}`/`{{upstream_name}}`/`{{harness}}`-style placeholders only, containing the empty block `<!-- GENERATED:FORKLIFT_START -->\n<!-- GENERATED:FORKLIFT_END -->` where the generated section is spliced.
- In `lib/commands/render.ts` add `generateAgentMd(reg, filledTemplate): string`: splices between the markers `## Fork Identity & Remotes` (harness fork/upstream remote+branch, `expected_fork_commit_count`), `## Fork-Owned Features` table (name | description | owned paths, joined with `<br>`), `## Verification Commands` (`harness.typecheck_command`, `test_command`, `lint_command`), `## Divergences & Intentional Removals` lists (path + reason). Pipe/backtick escaping must reuse the same cell-escaping the divergence/owned-symbol tables use in this file; if that logic is inline there today, extract it as `escapeCell(text: string): string` in `lib/commands/render.ts` and call it from both places. Render reports one extra line to stderr naming the AGENT.md path it wrote or updated, matching the existing per-output report style.
- Target path: `path.resolve(path.dirname(registryPath), "..", "AGENT.md")`. If the file exists, replace only the bytes strictly between the two markers and keep every other byte verbatim; if it does not exist, write the filled template. No stamp: AGENT.md has no frontmatter.
- Existing file that lacks either marker: hard error naming the path, exit 1 — render must never splice into a file whose provenance it cannot see. `--no-agent-md` skips the step entirely, including the error, so an operator can recover from a foreign AGENT.md by opting out.
- SKILL.md and the legacy registry-copy writes are unchanged by this feature; only the new AGENT.md path is added.

Consequence for the forks: owp already carries a hand-maintained `AGENTS.md` (plural). It is not touched — the generated file is `AGENT.md`, a separate path read by Antigravity/Gemini-style tools — and the duplication concern is accepted because the generated block is the only machine-maintained source of fork-ownership rules.

### 4. `.agents` adapter (universal layout)

`.agents/skills` + `.agents/skills.json` is the cross-tool convention (this workspace already uses it at `/var/home/user/Work/.agents/`), not an Antigravity-specific one, so the adapter is named for the layout. Append to `adapters/tools.yaml` (same key order as existing entries; `examples` stay empty because those are observed snapshots and none are observed for this layout yet):

```yaml
  - id: agents
    skill_format: dir
    label: AGENTS.md convention (.agents/skills, .agents/skills.json) — Antigravity, Gemini CLI
    role: both
    install_paths:
      skills_dir: .agents/skills
      commands_dir: null
      skills_dir_legacy: null
      commands_dir_legacy: null
    examples:
      fork: {}
      host: {}
```

`docs/todo/agent-md-generation.md` §2 names the adapter `antigravity`; update that section's adapter block and its benefit sentence to the `agents` id and the universal-layout rationale.

### 5. Refresh both forks: generate, install, register, rebaseline

Everything the earlier steps changed lands in the forks in one pass, so the commit-count baseline is measured once at the end.

1. `mkdir -p /var/home/user/Work/k8s_gateway/.agents/skills`, then `bun bin/forklift install --target` each fork (owp, k8s_gateway). owp has no `.agents/`, so only k8s_gateway receives `.agents/skills/forklift-{doctor,init}/SKILL.md`.
2. `bun bin/forklift render --registry …` per fork — writes/updates `AGENT.md` in both (owp gains a new file next to `AGENTS.md`).
3. Register the new fork-owned paths so doctor check 1 does not flag them: owp — add `AGENT.md` to the `Forklift harness` feature's `owned_paths` in `/var/home/user/Work/oh-wiblo-pi/.forklift/registry.yaml`; k8s_gateway — add a `Forklift harness` feature with `status: draft` whose `owned_paths` list each installed path individually (`.forklift/`, `.omp/skills/sync-upstream/`, `.omp/skills/forklift-doctor/`, `.omp/skills/forklift-init/`, `.omp/commands/sync-upstream.md` when present, `.agents/skills/forklift-doctor/`, `.agents/skills/forklift-init/`, `AGENT.md`) rather than the `.omp/` directory — an over-broad owned path turns every future upstream file under `.omp/` into a "prefer ours" conflict decision. owp's existing entries stay as they are.
4. Rebaseline `expected_fork_commit_count` with the self-referential rule: the baseline must equal the post-commit range count, so measure `M` with all other fork commits already in place, write `M + 1`, commit, then re-measure. owp's current range count is 96 with a registry value of 95 (my registry-fix commit `70dec9e86b` moved it), so owp gets 97; k8s_gateway is measured fresh.
5. Commit per fork. owp stages only `.forklift/registry.yaml`, `AGENT.md`, `.omp/skills/sync-upstream/SKILL.md`, `.omp/skills/sync-upstream/feature-registry.yaml`; the working tree also holds unrelated WIP (`sync.ts`, `SKILL.md.template`, `.omp/commands/sync-upstream.md`, `interactive-mode.ts`, `google-ai.ts`, `packages/coding-agent/test/tools/web-search-google-ai.test.ts`) that must not be staged. k8s_gateway commits `.agents/`, `AGENT.md`, the registry edit, and the step-1 dogfood paths if step 1 deferred them.

### 6. Packaging metadata

`forklift/package.json`: `"name": "@whiteblossom/forklift"`, `"files": ["bin", "lib", "schema", "templates", "adapters", "skills", "README.md", "LICENSE"]`, `"publishConfig": { "registry": "https://code-dev.whiteblossom.net/api/packages/whiteblossom/npm/" }`, `"engines": { "bun": ">=1.3" }`, `"repository": "https://code-dev.whiteblossom.net/whiteblossom/forklift"`; version stays `0.1.0`. Add a `Running forklift` section to `README.md`: from a checkout `bun bin/forklift <doctor|render|install> …`; from any fork repo `npx --yes @whiteblossom/forklift@X doctor`. `bun pm pack --dry-run` (fallback `npm pack --dry-run`) must list exactly the `files` entries and no `.git`, `docs/`, or local scratch.

### 7. Supply-chain npm rules (security-pipeline)

`security-pipeline/policy/supply_chain.rego`, mirroring the existing helm/docker anti-squatting rules:

- `is_authorized_npm_registry(match, _)` true for `code[-.]dev\.whiteblossom\.net/api/packages/whiteblossom/npm` with or without trailing slash, and for the literal `${NPM_REGISTRY}` variable form (the same escape hatch the helm rules grant for `${REGISTRY}`).
- deny: a `step.run` containing `npm publish` whose registry — matched from `registry=<url>` on the publish line, or from a `//<host>/api/packages/<owner>/npm/` string written into `.npmrc` in the same job — is not authorized. Message exactly: `Supply Chain Violation: Unauthorized npm registry '%v'. Must target 'code-dev.whiteblossom.net/api/packages/whiteblossom/npm'`.
- deny: a publish step whose package name is not scoped `@whiteblossom/<repo_name>`. Message exactly: `Supply Chain Violation: Unauthorized npm package scope '%v'. Must publish '@whiteblossom/%v'`.
- `security-pipeline/policy/policy_test.rego`: three rego tests in the file's existing style (`test_x if { inp := {...}; deny["<exact message>"] with input as inp }`) — authorized registry produces no deny, foreign host produces deny with the exact message, foreign scope produces deny with the exact message.

Verify with `conftest test policy/supply_chain.rego policy/policy_test.rego --data /tmp/npm_data.json` if the local conftest builds run tests, else `opa test policy/`; if neither binary is available, verify behaviorally: run the skill's documented `conftest test … --data …` command from `backstage-import` Step 5 against a fixture workflow containing a foreign-registry publish and assert the exact message appears. Update `security-pipeline/docs/policies.md` policy table with the two new deny rules.

### 8. Publish the local history to the existing Forgejo repo

`whiteblossom/forklift` already exists on `code-dev.whiteblossom.net` (public, default branch `development`, created 2026-10-02; SSH `ssh://git@code-dev.whiteblossom.net/whiteblossom/forklift.git`, clone `https://code-dev.whiteblossom.net/whiteblossom/forklift.git`). Nothing to create. PR #1 (`feat/forklift-bootstrap` → `development`, head `a75d833`, +2153/15 files, `mergeable: true`) carries the initial harness commit that is already in the local history; the repo is configured fast-forward-only (`allow_merge_commits: false`, `allow_squash_merge: false`, `allow_fast_forward_only_merge: true`), so merging it advances `development` to `a75d833` with no new commit, and the two newer local commits (`6f2e445` doctor CLI/deletion audit, `ed2ed0b` backlog docs) then fast-forward on top.

1. `git -C /var/home/user/Work/forklift remote -v` — if an origin already points at that URL, keep it; otherwise `git remote add origin https://code-dev.whiteblossom.net/whiteblossom/forklift.git`.
2. Rename the local branch to match the remote default: `git branch -m main development` (local history contains `development`'s current tip `89e95bf` as an ancestor — verify with `git merge-base --is-ancestor 89e95bf development` before pushing; if it is not, stop and report instead of forcing).
3. Merge PR #1 (fast-forward), then `git push origin development`. Merging a PR the local branch already contains is safe here precisely because of the fast-forward-only setting; do not use `git push --force`.
4. `forklift/catalog-info.yaml` gains `artifacts: [npm-package]` under `spec` — `backstage.rego` `valid_artifacts` already contains `npm-package`, so no policy change is required for it. Skip `backstage.io/techdocs-ref` (no `mkdocs.yml` in this repo; the annotation would 404). Push this with the `publish-npm.yaml` workflow (step 9) so the first Forgejo Actions run already sees the final catalog file.

Archetype docs, three places, `tool` row allowed-artifacts list gains `npm-package`: `backstage/docs/architecture/repository-archetypes.md` (~line 14), `security-pipeline/docs/archetypes.md` (~line 12), `backstage/skills/backstage-import/SKILL.md` (~line 36). Commit and push each repo directly (the no-manual-PR rule applies to `whiteblossom-apps` only).

### 9. `publish-npm.yaml` + first publish

`forklift/.forgejo/workflows/publish-npm.yaml`, following `templates/flux-service-template/skeleton/.forgejo/workflows/publish-chart.yaml` conventions (same action URLs, `mise exec --` wrappers, `set -euo pipefail`): `on: push: tags: ['v*']` + `workflow_dispatch`; checkout via `https://github.com/actions/checkout@v4`; `https://github.com/jdx/mise-action@v4` with `install_args: bun`; self-check `mise exec -- bun --version`; tag guard comparing `github.ref_name` with `package.json` `version` (fail on mismatch, since the registry rejects republishing a version); write `.npmrc` with `//code-dev.whiteblossom.net/api/packages/whiteblossom/npm/:_authToken=${{ secrets.NPM_TOKEN }}`; `mise exec -- npm publish --access public --registry …`. New `forklift/mise.toml` pins `[tools] bun = "1.3.12"` (matches owp's pin).

Provision the secret via the Gitea Actions Secrets API — the same shape `plugins/scaffolder-backend-module-gitea-apps/src/actions/provisionForgejoSecrets.ts` uses (plain text in `data`, `PUT /repos/whiteblossom/forklift/actions/secrets/NPM_TOKEN`, token needs package write scope). First run via `workflow_dispatch` on `development` with the version-guard branch suppressed is not needed — dispatch is meant for the tag path, so tag `v0.1.0` on `development` and push.

### 10. Scaffolder template for npm-publishing tool repos

`backstage/templates/npm-tool-template/` cloned from the flux template's shape: `template.yaml` (parameters `packageName`, `description`, `repoUrl` with `RepoUrlPicker` restricted to `code-dev.whiteblossom.net`) and steps `fetch:template` → `publish:gitea` (`defaultBranch: development`) → `provision:forgejo-secrets` (one entry, name `NPM_TOKEN`, value from a scaffolder secret parameter — the action accepts an arbitrary `{name, value}` array) → `catalog:register`. No `repo:reconcile` / `commit:flux-manifests` steps: those exist for chart+image deployables, and a tool component generates no Flux manifests. Skeleton: `catalog-info.yaml` (`spec.type: tool`, `artifacts: [npm-package]`), `package.json`, `mise.toml`, `README.md`, `.forgejo/workflows/publish-npm.yaml` (parameterized on `packageName`), no chart, no Dockerfile, no techdocs.

Template discovery is **absent today, not configured elsewhere** (verified this session): `backstage/chart/templates/deployment.yaml:38-41` passes exactly `--config app-config.yaml --config app-config.dev.yaml`, and neither file contains a `templates:` key, while `@backstage/plugin-scaffolder-backend` is registered in `packages/backend/src/index.ts:30`. So the scaffolder has zero template providers and even `flux-service-template` is not discoverable through the UI. Fix that as part of this step, in `backstage/app-config.yaml` (top level, after the existing `backend:`/`scaffolder:` keys):

```yaml
templates:
  providers:
    - type: file
      url: ./templates
```

This registers every `template.yaml` under `backstage/templates/`, so `flux-service-template` becomes discoverable again alongside the new template. A config-only change does not bump the backstage image, so Flux will not roll it out by itself: after pushing, restart the deployment with `kubectl -n platform-system rollout restart deploy/backstage` (the platform cluster context in this workspace's kubeconfig; confirm with `kubectl -n platform-system get deploy backstage -o jsonpath='{.status.readyReplicas}'` reaching the new replica count). If cluster access is unavailable, leave the push in place, record that discovery verification is deferred to the next backstage deploy, and continue with steps that do not depend on it.

## Critical files & anchors

- `forklift/bin/forklift-doctor:298,365,384` — the three `import.meta.dir`-derived paths that break when the body moves one level deeper.
- `forklift/lib/registry.ts` — `fillTemplate` supports `{{var}}` + `{{#if}}` only; no `{{#each}}`, which is why AGENT.md tables are code-generated.
- `security-pipeline/policy/supply_chain.rego` — `is_authorized_forgejo_helm_target` block is the pattern the npm registry rule copies (including the `${VAR}` escape hatches).
- `backstage/templates/flux-service-template/template.yaml` + `skeleton/.forgejo/workflows/publish-chart.yaml` — step list and workflow conventions for both step 9 and step 10.
- `forklift/catalog-info.yaml` — already `spec.type: tool`, owner `platform-team`; only `artifacts` is added.

## Verification

Run from the stated working directory; each check is a new-behavior proof, not a build.

1. CLI unification (cwd `forklift`): `bun bin/forklift --help` lists `render`, `install`, `doctor` with each subcommand's flags; `bun bin/forklift --version` prints `0.1.0`; `bun bin/forklift bogus` exits 2 with usage on stderr; `bun bin/forklift doctor --list` prints the seven-check table (proves the schema/root paths still resolve).
2. Render/install parity (unchanged behavior): `bun bin/forklift render --no-agent-md --registry /var/home/user/Work/oh-wiblo-pi/.forklift/registry.yaml` and the same for `k8s_gateway` produce byte-identical SKILL.md (capture md5 before and after); `bun bin/forklift install --target <fork>` reports `0 written, N unchanged`; `bun bin/forklift doctor --registry … --json` returns the same `ok`/check statuses as the pre-change CLI in both forks.
3. AGENT.md, default path (cwd `k8s_gateway`): `bun bin/forklift render --registry .forklift/registry.yaml` with no flags creates `AGENT.md` containing `GENERATED:FORKLIFT_START`, a feature table listing the ingressClusterIPFallback feature with its owned paths, and the registry's `expected_fork_commit_count`; appending a hand-written paragraph below the block and re-rendering leaves that paragraph byte-identical (the preservation contract); deleting one marker from an existing AGENT.md makes render exit 1 naming the path, and `--no-agent-md` makes the same file render successfully again.
4. `.agents` adapter (cwd `k8s_gateway`): `bun bin/forklift install --target . --dry-run` lists `.agents/skills/forklift-doctor/SKILL.md [agents]` and `.agents/skills/forklift-init/SKILL.md`; the real run writes both with a `<!-- forklift v1 -->` stamp; `bun bin/forklift doctor --check 7` passes with the new stamps.
5. Counts (both forks): `bun bin/forklift doctor --check 5` exits 0 in owp and k8s_gateway after step 5.
6. Hosting: after step 8, `git -C /var/home/user/Work/forklift log --oneline -1 development` equals the remote's `development` tip (`git ls-remote origin development`) and PR #1 reports `state: closed`, `merged: true`.
7. Package contents (cwd `forklift`): `bun pm pack --dry-run` output contains `bin/forklift`, `lib/commands/*.ts`, `schema/registry.schema.yaml`, `templates/SKILL.md.tmpl`, `adapters/tools.yaml`, `skills/*/SKILL.md` and contains no `.git/`, no `docs/todo/`, no `AGENT.md`.
8. Policy: the rego tests from step 7 pass (`opa test`/`conftest`), and a fixture workflow with `npm publish --registry https://registry.npmjs.org` produces the exact deny message while the real `publish-npm.yaml` produces none.
9. Publish: after tagging `v0.1.0`, the workflow run succeeds; from a scratch directory `npm view --registry https://code-dev.whiteblossom.net/api/packages/whiteblossom/npm/ @whiteblossom/forklift versions` lists `0.1.0`, and `npx --yes @whiteblossom/forklift@0.1.0 doctor --list` prints the seven-check table there (this is the end-to-end proof that a machine needs nothing but Bun and the registry).
10. Template discovery and dogfood: after the `rollout restart`, the scaffolder UI at `https://backstage-dev.whiteblossom.net/create` lists both `flux-service-template` and `npm-tool-template`; scaffolding a scratch repo through `npm-tool-template` produces a repo containing `publish-npm.yaml` and a `tool`/`npm-package` `catalog-info.yaml`, and the repo appears in the catalog; delete the scratch repo afterwards.

## Assumptions & contingencies

- Package name `@whiteblossom/forklift` on the dev registry `code-dev.whiteblossom.net`. If that host does not serve `/api/packages/whiteblossom/npm/`, probe the alternatives (`code.dev.whiteblossom.net`, prod `code.whiteblossom.net`) and publish to whichever responds; the npm registry path shape `<host>/api/packages/<owner>/npm/` is Forgejo's and the workflow/policy strings follow it.
- `npm-package` on `tool` is documentation-only: `backstage.rego`'s `valid_artifacts` is a flat set with no per-archetype restriction, so no policy code change is needed for the catalog declaration. If a later check reveals a per-archetype rule not visible in this repo, extend `backstage.rego` and its tests then.
- Templates provider: the config chain is fully known (two `--config` files, neither declaring `templates:`), so step 10 adds the provider block unconditionally. If the restarted backend still lists no templates, the cause is not the config — check the backend logs for a `templates.providers` schema error and report rather than adding a second provider.
- If `provision:forgejo-secrets` cannot be driven from a scaffolder secret parameter (scaffolder secrets are declared under `scaffolder.secrets` in `app-config.yaml`, which currently carries only `FLUX_WEBHOOK_TOKEN`), the operator pastes `NPM_TOKEN` into the template parameters' UI field and the action still provisions it; the repo-local forklift secret is provisioned directly through the API regardless.
- Push/merge credentials: the Forgejo API token reachable from this workstation reports `permissions.push: false` for `whiteblossom/forklift` (read-only for the org), so if `git push origin development` or the PR merge is rejected for auth, hand the operator the exact two commands (`merge PR #1` in the UI, then `git push origin development`) and continue with steps 9–10 once the remote tip matches the local `development`.
- User WIP in owp (`sync.ts`, `SKILL.md.template`, `.omp/commands/sync-upstream.md`, `interactive-mode.ts`, `google-ai.ts`, and the new google-ai test) is never staged by these steps; if any of those files conflict with generated output, stop and report rather than committing over them.
- Every fork commit created here (steps 1, 3–5) shifts check 5; the rebaseline in step 5 is the last commit touching the registry, so its own commit is accounted for by the `M + 1` rule.