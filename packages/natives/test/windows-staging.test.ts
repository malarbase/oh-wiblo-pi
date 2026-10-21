/**
 * Regression for the Windows `bun install -g` update path: when an `omp`
 * process is running, bun cannot overwrite a locked
 * `node_modules/@oh-my-pi/pi-natives/native/pi_natives.win32-x64.node` during
 * package update and silently keeps the old binary next to the new ESM
 * wrapper. The next launch then throws `<sym> is not a function` deep inside
 * tool execution (see Discord report, 2026-05-14).
 *
 * The fix has two halves, both pinned by this test:
 *   1. The loader stages `nativeDir/<filename>.node` → `versionedDir/<filename>.node`
 *      (per-package-version cache under `~/.omp/natives/<version>/`) so the
 *      running process holds its OS-level handle on a path bun is never asked
 *      to overwrite. Gated to Windows + node_modules installs + non-compiled
 *      mode by `shouldStageNodeModulesAddon`.
 *   2. `resolveLoaderCandidates` puts the staged path ahead of the
 *      `node_modules` path so subsequent updates land in node_modules without
 *      contention.
 *
 * Both behaviors are off in workspace dev (`bun --cwd=packages/natives run
 * build`) and on non-Windows so the regular path is unchanged.
 */
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	cleanupStaleNativeVersions,
	getAddonFilenames,
	initLoaderContext,
	prepareNativeVersionDir,
	resolveLoaderCandidates,
	shouldStageNodeModulesAddon,
	validateLoadedBindings,
} from "../native/loader-state.js";
import {
	VERSION_STAMP_MAGIC,
	VERSION_STAMP_SIZE,
	bindingsHaveReleaseIdentity,
	bindingsReleaseVersion,
	containsVersionStamp,
} from "../native/version-sentinel.js";
import packageJson from "../package.json" with { type: "json" };

const winNodeModulesNativeDir = "C:\\Users\\Admin\\node_modules\\@oh-my-pi\\pi-natives\\native";
const winWorkspaceNativeDir = "C:\\Users\\Admin\\dev\\oh-my-pi\\packages\\natives\\native";
const posixNodeModulesNativeDir = "/home/u/proj/node_modules/@oh-my-pi/pi-natives/native";

describe("windows native addon staging", () => {
	it("stages only on Windows node_modules installs", () => {
		// Windows + node_modules install + npm (not compiled) → stage.
		expect(
			shouldStageNodeModulesAddon({
				platform: "win32",
				isCompiledBinary: false,
				nativeDir: winNodeModulesNativeDir,
			}),
		).toBe(true);

		// Windows workspace dev: nativeDir lives outside node_modules → never stage,
		// otherwise rebuilds via `bun --cwd=packages/natives run build` would be
		// shadowed by a stale cache copy.
		expect(
			shouldStageNodeModulesAddon({
				platform: "win32",
				isCompiledBinary: false,
				nativeDir: winWorkspaceNativeDir,
			}),
		).toBe(false);

		// Windows compiled binary: the embedded-addon extractor already populates
		// versionedDir; staging from a non-existent nativeDir would race that.
		expect(
			shouldStageNodeModulesAddon({
				platform: "win32",
				isCompiledBinary: true,
				nativeDir: winNodeModulesNativeDir,
			}),
		).toBe(false);

		// Non-Windows: bun's atomic rename works fine, no need to stage.
		expect(
			shouldStageNodeModulesAddon({
				platform: "linux",
				isCompiledBinary: false,
				nativeDir: posixNodeModulesNativeDir,
			}),
		).toBe(false);
		expect(
			shouldStageNodeModulesAddon({
				platform: "darwin",
				isCompiledBinary: false,
				nativeDir: posixNodeModulesNativeDir,
			}),
		).toBe(false);
	});

	it("prepends versionedDir candidates ahead of node_modules when staging on Windows", () => {
		const versionedDir = "C:\\Users\\Admin\\.omp\\natives\\15.0.1";
		const userDataDir = "C:\\Users\\Admin\\AppData\\Local\\omp";
		const candidates = resolveLoaderCandidates({
			addonFilenames: getAddonFilenames({ tag: "win32-x64", arch: "x64", variant: "baseline" }),
			isCompiledBinary: false,
			stageFromNodeModules: true,
			nativeDir: winNodeModulesNativeDir,
			execDir: "C:\\Users\\Admin\\node_modules\\.bin",
			versionedDir,
			userDataDir,
		});

		const versionedBaseline = path.join(versionedDir, "pi_natives.win32-x64-baseline.node");
		const versionedDefault = path.join(versionedDir, "pi_natives.win32-x64.node");
		const nodeModulesBaseline = path.join(winNodeModulesNativeDir, "pi_natives.win32-x64-baseline.node");

		// Staged paths must be probed first so the running process locks the cache
		// copy and bun is free to replace the node_modules copy on next update.
		expect(candidates).toContain(versionedBaseline);
		expect(candidates).toContain(versionedDefault);
		expect(candidates.indexOf(versionedBaseline)).toBeLessThan(candidates.indexOf(nodeModulesBaseline));

		// User-data dir is reserved for compiled-binary mode — staging must not
		// quietly start probing it on npm installs (where it never contains the
		// addon anyway).
		const userDataBaseline = path.join(userDataDir, "pi_natives.win32-x64-baseline.node");
		expect(candidates).not.toContain(userDataBaseline);
	});

	it("classifies only Windows node_modules paths case-insensitively", () => {
		const leafPackageDir = "/tmp/node_modules/@oh-my-pi/pi-natives-darwin-arm64";
		const uppercaseNodeModulesNativeDir = "/tmp/NODE_MODULES/@oh-my-pi/pi-natives/native";
		const variantCacheKey = "__PI_NATIVE_VARIANT_CACHE";
		const previousVariantCache = process.env[variantCacheKey];
		try {
			const workspace = initLoaderContext({
				platform: "linux",
				isCompiledBinary: false,
				nativeDir: "/tmp/oh-my-pi/packages/natives/native",
				leafPackageDir,
			});
			const installed = initLoaderContext({
				platform: "linux",
				isCompiledBinary: false,
				nativeDir: "/tmp/node_modules/@oh-my-pi/pi-natives/native",
				leafPackageDir,
			});
			const uppercaseWorkspace = initLoaderContext({
				platform: "linux",
				isCompiledBinary: false,
				nativeDir: uppercaseNodeModulesNativeDir,
				leafPackageDir,
			});
			const uppercaseWindowsInstall = initLoaderContext({
				platform: "win32",
				isCompiledBinary: false,
				nativeDir: uppercaseNodeModulesNativeDir,
				leafPackageDir,
			});
			const leafCandidate = path.join(leafPackageDir, installed.addonFilenames[0]);
			const windowsLeafCandidate = path.join(leafPackageDir, uppercaseWindowsInstall.addonFilenames[0]);
			const workspaceCandidate = path.join(uppercaseNodeModulesNativeDir, uppercaseWorkspace.addonFilenames[0]);

			expect(workspace.isWorkspaceLoad).toBe(true);
			expect(workspace.leafPackageDir).toBeNull();
			expect(workspace.candidates).not.toContain(leafCandidate);
			expect(installed.isWorkspaceLoad).toBe(false);
			expect(installed.leafPackageDir).toBe(leafPackageDir);
			expect(installed.candidates).toContain(leafCandidate);
			expect(installed.candidates[0]).toBe(leafCandidate);

			expect(uppercaseWorkspace.isWorkspaceLoad).toBe(true);
			expect(uppercaseWorkspace.leafPackageDir).toBeNull();
			expect(uppercaseWorkspace.candidates[0]).toBe(workspaceCandidate);

			expect(uppercaseWindowsInstall.isWorkspaceLoad).toBe(false);
			expect(uppercaseWindowsInstall.leafPackageDir).toBe(leafPackageDir);
			expect(uppercaseWindowsInstall.stageFromNodeModules).toBe(true);
			expect(uppercaseWindowsInstall.candidates).toContain(windowsLeafCandidate);
		} finally {
			if (previousVariantCache === undefined) delete process.env[variantCacheKey];
			else process.env[variantCacheKey] = previousVariantCache;
		}
	});

	it("removes only older version directories after the current native version loads", async () => {
		const nativesDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-natives-cache-"));
		const currentMajor = Number.parseInt(packageJson.version, 10);
		const futureVersion = `${currentMajor + 1}.0.0`;
		const staleVersion = "15.10.11";
		const freshVersion = "15.10.12";
		try {
			await fs.mkdir(path.join(nativesDir, staleVersion));
			await fs.mkdir(path.join(nativesDir, freshVersion));
			await fs.mkdir(path.join(nativesDir, packageJson.version));
			await fs.mkdir(path.join(nativesDir, futureVersion));
			await fs.mkdir(path.join(nativesDir, "not-a-version"));
			await Bun.write(path.join(nativesDir, "README.txt"), "not a version directory");
			await fs.utimes(path.join(nativesDir, staleVersion), new Date(0), new Date(0));
			await fs.utimes(path.join(nativesDir, freshVersion), new Date(0), new Date(0));
			prepareNativeVersionDir(path.join(nativesDir, freshVersion));

			const removed = cleanupStaleNativeVersions({ nativesDir, currentVersion: packageJson.version });

			expect(removed.map(filePath => path.basename(filePath))).toEqual([staleVersion]);
			expect((await fs.readdir(nativesDir)).sort()).toEqual(
				["README.txt", freshVersion, packageJson.version, futureVersion, "not-a-version"].sort(),
			);
		} finally {
			await fs.rm(nativesDir, { recursive: true, force: true });
		}
	});
});

describe("pi-natives version sentinel", () => {
	it("Rust source pairs the release identity export with the post-link stamp slot", async () => {
		// The stale-binary protection `native/loader-state.js` is built on:
		// `scripts/stamp-native-version.ts` writes `package.json#version` into a
		// fixed 64-byte slot after linking, `__piNativesBuildVersion()` reads it
		// back at runtime, and the loader compares it against the package
		// version. The per-release `__piNativesV*` sentinel is gone from the
		// Rust source — the pairing is with the slot, not a versioned export
		// name. Pin that pairing here so release-script regressions fail before
		// they reach CI.
		const libRs = await Bun.file(path.join(import.meta.dir, "../../../crates/pi-natives/src/lib.rs")).text();

		// Release identity: the export the loader's `bindingsReleaseVersion`
		// reads to learn a loaded addon's release.
		const identityMatch = libRs.match(/js_name = "(__piNativesBuildVersion)"/);
		expect(
			identityMatch,
			'Rust release identity `js_name = "__piNativesBuildVersion"` not found in lib.rs',
		).not.toBeNull();
		expect(identityMatch?.[1]).toBe("__piNativesBuildVersion");

		// Stamp emission: the magic linked into the binary (inside the
		// `VERSION_STAMP` placeholder) must be the exact JS constant, and it
		// must occur exactly once — the post-link stamp tool refuses to guess
		// when the magic occurs more than once.
		expect(VERSION_STAMP_MAGIC).toBe("PI_NATIVES_VERSION_STAMP:");
		const magicMatches = libRs.match(/b"PI_NATIVES_VERSION_STAMP:"/g) ?? [];
		expect(magicMatches.length, "The stamp magic must be linked into the binary exactly once").toBe(1);

		// The slot geometry must match the JS helpers and the stamp writer:
		// magic length for `__piNativesBuildVersion`'s read range, slot size for
		// the writer's NUL-padded payload.
		const slotSize = Number(libRs.match(/const VERSION_STAMP_LEN: usize = (\d+)/)?.[1]);
		expect(slotSize, "Rust stamp slot size drifted from the JS `VERSION_STAMP_SIZE` helpers").toBe(
			VERSION_STAMP_SIZE,
		);
		const magicLen = Number(libRs.match(/const VERSION_STAMP_MAGIC_LEN: usize = (\d+)/)?.[1]);
		expect(magicLen, "Rust stamp magic length drifted from the JS `VERSION_STAMP_MAGIC` constant").toBe(
			VERSION_STAMP_MAGIC.length,
		);
		// The runtime reader must skip exactly the magic prefix of the slot.
		expect(libRs).toContain("VERSION_STAMP_MAGIC_LEN..VERSION_STAMP_LEN");

		// The stamp payload — `magic` + `package.json#version` + NUL padding —
		// must fit the slot, or the post-link writer hard-fails.
		const slack = VERSION_STAMP_SIZE - VERSION_STAMP_MAGIC.length - 1;
		expect(
			packageJson.version.length,
			`@oh-my-pi/pi-natives@${packageJson.version} no longer fits the ${VERSION_STAMP_SIZE}-byte stamp slot`,
		).toBeLessThanOrEqual(slack);
	});
	it("compiled .node binary carries the stamp and release identity for the package version", async () => {
		// Catches the stale-binary problem: after a version bump, the Rust
		// source is correct but the `.node` on disk may still be from a previous
		// build. The JS loader validates the post-link stamp at load time, so
		// the same check on the disk bytes fails here instead of shipping as a
		// startup error or a later `<sym> is not a function` crash.
		const platformTag = `${process.platform}-${process.arch}`;
		// Find the binary for the current platform. x64 has -modern and -baseline
		// variants; other arches use a single unqualified name.
		const nativeDir = path.join(import.meta.dir, "../native");
		const candidates =
			process.arch === "x64"
				? [
						path.join(nativeDir, `pi_natives.${platformTag}-modern.node`),
						path.join(nativeDir, `pi_natives.${platformTag}-baseline.node`),
					]
				: [path.join(nativeDir, `pi_natives.${platformTag}.node`)];
		for (const candidate of candidates) {
			const exists = await Bun.file(candidate).exists();
			if (!exists) continue;
			// The disk bytes must carry the stamp for exactly this package
			// version (`containsVersionStamp` is what the loader's
			// `validateLoadedBindings` greps the same file for). A binary from an
			// older release fails here: its stamp names the old version, and
			// pre-stamp binaries carry no stamp at all.
			const byteMatches = await Bun.file(candidate).bytes();
			expect(
				containsVersionStamp(byteMatches, packageJson.version),
				`${candidate} does not carry the ${VERSION_STAMP_MAGIC}${packageJson.version} stamp. ` +
					"The binary is stale — rebuild with: bun --cwd=packages/natives run build",
			).toBe(true);

			// Try to load directly — this is exactly what the loader does.
			let addon: Record<string, unknown>;
			try {
				addon = require(candidate) as Record<string, unknown>;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(
					`Failed to load ${candidate}: ${message}\n` +
						"The .node file may be corrupted or built for a different platform. " +
						"Rebuild with: bun --cwd=packages/natives run build",
				);
			}
			// The release identity must be present and must agree with the
			// package version — the same pair of checks
			// `bindingsReleaseVersion`/`bindingsHaveReleaseIdentity` feed the
			// loader's stamp validation.
			expect(
				bindingsHaveReleaseIdentity(addon),
				`${candidate} does not identify its release (no \`__piNativesBuildVersion\` export or legacy \
sentinel).`,
			).toBe(true);
			expect(
				bindingsReleaseVersion(addon),
				`${candidate} reports another release than @oh-my-pi/pi-natives@${packageJson.version}. ` +
					"The binary is stale — rebuild with: bun --cwd=packages/natives run build",
			).toBe(packageJson.version);
			// And the loader's own validation must accept it — identical inputs,
			// identical verdict to a release install.
			expect(() =>
				validateLoadedBindings({ isWorkspaceLoad: false, packageVersion: packageJson.version }, addon, candidate),
			).not.toThrow();
			return; // one match is enough
		}
		throw new Error(
			`No native addon binary found for ${platformTag}. Rebuild with: bun --cwd=packages/natives run build`,
		);
	});
});
