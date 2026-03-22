# Update OMP

Pull the latest omp release, reinstall dependencies, reapply local changes, and relink the binary.

## Prerequisites

- Working directory: `/Users/malar/Personal/Code/oh-wiblo-pi`
- Local binary symlink: `~/.bun/bin/omp` -> local source
- Config: `~/.omp/agent/models.yml`

## Steps

1. **Check for uncommitted local changes**
   ```bash
   cd /Users/malar/Personal/Code/oh-wiblo-pi
   git status --short
   ```
   If there are local modifications (expected — the openai-compatible discovery patch and ptree fix), stash them before pulling.

2. **Pull latest**
   ```bash
   git stash  # only if local changes exist
   git pull --rebase
   ```

3. **Reapply local changes**
   ```bash
   git stash pop  # only if stashed in step 2
   ```
   If there are merge conflicts, resolve them. The local changes are in:
   - `packages/coding-agent/src/config/model-registry.ts` — openai-compatible discovery type + sync `!command` API key resolution
   - `packages/utils/src/ptree.ts` — Blob type inference fix for tsgo nightly

4. **Install dependencies**
   ```bash
   bun install
   ```

5. **Verify types pass**
   ```bash
   bun run check:ts
   ```
   Fix any issues before proceeding. Pre-existing errors in unrelated files from tsgo nightly regressions should be fixed, not ignored.

6. **Verify the binary symlink is correct**
   ```bash
   readlink ~/.bun/bin/omp
   ```
   Should point to `/Users/malar/Personal/Code/oh-wiblo-pi/packages/coding-agent/src/cli.ts`. If not:
   ```bash
   ln -sf /Users/malar/Personal/Code/oh-wiblo-pi/packages/coding-agent/src/cli.ts ~/.bun/bin/omp
   ```

7. **Verify model discovery still works**
   ```bash
   omp --list-models 2>&1 | grep cbhq | wc -l
   ```
   Should return 100+ models from the cbhq-llm-gateway endpoint.

## Conflict Resolution

If `model-registry.ts` conflicts during rebase, the local changes are:
- Import: `fetchOpenAICompatibleModels` from `@oh-my-pi/pi-ai`
- Schema: `Type.Literal("openai-compatible")` added to `ProviderDiscoverySchema`
- Validation: `baseUrl` required for `openai-compatible` discovery
- Switch: `case "openai-compatible"` in `#discoverModelsByProviderType`
- Method: `#discoverOpenAICompatibleModels` using `fetchOpenAICompatibleModels`
- Sync resolver: `resolveApiKeyConfigSync` using `Bun.spawnSync` for `!command` API keys
- Fallback resolver: uses `resolveApiKeyConfigSync` instead of returning undefined for `!command` keys

If upstream adds `openai-compatible` discovery natively, drop the local patch entirely and just use the upstream version.
