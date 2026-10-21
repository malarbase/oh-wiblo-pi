# Compiled Binary: `bytecode: true` Drops the `child_process` Binding

## Status

**Fixed** — `bytecode: false` in `packages/coding-agent/scripts/compile-binary.ts:63`, rebuilt, installed, and verified 2026-09-27.

Open follow-up: the bytecode boot-speed win can only be recovered after a Bun upgrade that is proven by A/B. See [Follow-up work](#follow-up-work).

## Issue

Every `web_search` call and every fresh `browser` launch from a bytecode-compiled binary failed with:

```
ReferenceError: childProcess is not defined
```

Thrown from the `Process2` constructor in the bundled `@puppeteer/browsers/lib/launch.js`, inside `childProcess.spawn(...)`. It is a fatal error with no provider fallback: the failure happens while spawning the headless browser, before any search provider runs.

## Root Cause

`bytecode: true` in `Bun.build()` (added 2026-09-15 in `16013e3ec1`) miscompiles this bundle so the default import of `child_process` inside `@puppeteer/browsers/lib/launch.js` loses its runtime binding.

The bundle is a large multi-module graph (~2600 `__esm` wrappers, ~20 MB). The import exists in the emitted source text but the bytecode lowering fails to wire the binding.

**Corrected mechanism.** An earlier revision of this writeup attributed the failure to the import sitting *mid-file* after `__esm`-wrapped statements, and cited a bytecode build from an already-bundled single-file entry working as a "known anomaly". That mechanism did not survive isolation testing. On Bun 1.3.14 all of the following build and run correctly with `bytecode: true`:

| Minimal repro | Result |
|---|---|
| top-level bare `child_process` default import | PASS |
| top-level `node:child_process` default import | PASS |
| **mid-file** bare `child_process` import (after a `var` statement) | PASS |
| **mid-file** `node:child_process` import | PASS |
| multi-module graph with a vendor default-import of `child_process` (mimics `@puppeteer/browsers`, includes `__esm` wrapping) | PASS |

So neither import position, nor bare vs `node:` specifier, nor `__esm` interleaving alone triggers it. It is a defect that manifests only at this bundle's scale and complexity. The practical consequence is that the original "restructure the bundle so imports land in a contiguous top-level block" fix idea is **not viable** — you cannot control where the bundler places an import inside a third-party module at this scale, and position alone is not the trigger anyway.

## Blast Radius

| Surface | Status |
|---|---|
| `web_search` (google-ai provider) | Was broken — always calls `launchHeadlessBrowser` (`src/web/search/providers/google-ai.ts:386,390`) |
| `browser` tool, fresh launch | Was broken — `src/tools/browser/registry.ts:181` → `src/tools/browser/launch.ts:465` |
| `browser` tool, CDP attach/reuse | Unaffected — `findReusableCdp` (`attach.ts:369`) never reaches the launch path |
| other `node:child_process` use | Unaffected — only this one default import lost its binding |

Not "all `child_process` is broken": it is specific to that import in this bundle.

## Fix

```diff
-			// Precompiled bytecode skips parsing the ~20 MB bundle at boot:
-			// `omp --version` 256 ms -> 30 ms on M4 Max (+52 MB binary).
-			// Keep import.meta.resolve in bundled dependencies valid under bytecode.
+			// Precompiled bytecode would skip parsing the ~20 MB bundle at boot,
+			// but it is a known defect on Bun 1.3.x: the bytecode compiler drops
+			// the runtime binding for the default import of `child_process`
+			// inside @puppeteer/browsers/lib/launch.js. Every spawn through
+			// launchHeadlessBrowser then throws "childProcess is not defined",
+			// breaking web_search and the browser tool's fresh-launch path.
+			// Do not re-enable until proven by the A/B described below.
 			format: "esm",
-			bytecode: true,
+			bytecode: false,
```

Also deleted the temporary A/B harness `packages/coding-agent/scripts/tmp-ab-bytecode.ts`.

## Verification

Same query, same machine, before vs after:

| Binary | Command | Result |
|---|---|---|
| old installed `owp` (343 MB, bytecode) | `owp search --provider=google-ai "test query"` | **FAIL** — `ReferenceError: childProcess is not defined` at `Process2` |
| rebuilt `dist/owp` (182 MB, no bytecode) | `./dist/owp search --provider=google-ai "who invented the transistor"` | **PASS** — 8 real sources |
| installed `owp` after install (182 MB) | `owp search --provider=google-ai "transistor invention 1947"` | **PASS** — sources returned, no error |

Note the search CLI flag is `--provider=<value>`; the `-p` form used in the original notes is rejected by this version.

Binary size dropped 343 MB → 182 MB.

## Cost Accepted

Boot time. `--version` went from ~30 ms with bytecode to **~820 ms** measured here (3 runs, 0.82 s each), which matches the ~256 ms parse cost the original comment cited, scaled to this machine. That is a real regression, and the only reason the flag existed. Correctness wins while the defect stands.

## Follow-up Work

1. **Pin the Bun version used for release builds.** `mise.toml` pins `bun = "1.3.12"` and that install exists, but the `bun` on `PATH` was `1.3.14` (a global install, not mise-resolved). The broken artifact was therefore not reproducible by inspection, and this bug is Bun-version-sensitive. Make the release toolchain resolve to an exact, pinned version.

2. **Bun upgrade to recover the boot-speed win — do not adopt on faith.** Only re-enable `bytecode: true` after upgrading Bun past 1.3.14 *and* proving it:
   - build with `bytecode: true` using the same options as `compile-binary.ts`
   - run `owp search --provider=google-ai <query>` and confirm real sources are returned
   - confirm the `browser` tool's fresh-launch path also works, since it shares `launchHeadlessBrowser`
   A passing `omp search` alone is the regression test for the specific binding that broke; check `browser` too, since it is the other surface through the same function.

3. **Report upstream if it is still broken.** The minimal repros above all pass, so a minimal upstream report will not reproduce. A report would need the full-bundle A/B. Worth filing against Bun's bytecode compiler with the before/after evidence here.

## Files Involved

| File | Role |
|------|------|
| `packages/coding-agent/scripts/compile-binary.ts:63` | **Fix site** — `bytecode: false` |
| `packages/coding-agent/scripts/compile-binary.ts:49-62` | Warning comment explaining why it must stay off |
| `packages/coding-agent/scripts/build-binary.ts` | Build entry calling `compileCodingAgent`; writes `dist/`, does **not** install to `~/.local/bin` |
| `src/tools/browser/launch.ts:465` | `launchHeadlessBrowser` — shared by search + browser tool |
| `src/tools/browser/registry.ts:181` | Browser tool fresh-launch callsite |
| `src/web/search/providers/google-ai.ts:386,390` | Search provider launch callsites |
| `node_modules/@puppeteer/browsers/lib/launch.js` | The import whose binding was lost; `Process2` constructor is first use |
| `mise.toml:2` | `bun = "1.3.12"` — pin that disagrees with what was on `PATH` |
