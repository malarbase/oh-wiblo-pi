import * as fs from "node:fs/promises";
import * as path from "node:path";
import { $which, WhichCachePolicy } from "@oh-my-pi/pi-utils";
import { execCommand } from "../../../../exec/exec";
import type { CustomCommand, CustomCommandAPI } from "../../types";

export class InstallBinaryCommand implements CustomCommand {
	name = "install-binary";
	description = "Build and install the owp binary to your PATH";

	constructor(private api: CustomCommandAPI) {}

	async execute(
		args: string[],
		ctx: { ui: { notify: (message: string, type: "info" | "error") => void } },
	): Promise<string | undefined> {
		const repoRoot = await this.#findRepoRoot();
		if (!repoRoot) {
			ctx.ui.notify(
				"Could not find the oh-wiblo-pi repository root. Run this command from inside the repo.",
				"error",
			);
			return;
		}

		const buildScript = path.join(repoRoot, "packages", "coding-agent", "scripts", "build-binary.ts");
		try {
			await fs.access(buildScript);
		} catch {
			ctx.ui.notify(`Build script not found at ${buildScript}`, "error");
			return;
		}

		const subcommand = args[0]?.toLowerCase();
		const explicitDest = subcommand === "promote" ? args[1] : subcommand === "build" ? undefined : args[0];

		// Build phase
		if (subcommand !== "promote") {
			const buildOk = await this.#build(repoRoot, buildScript, ctx);
			if (!buildOk) return;

			if (subcommand === "build") {
				await this.#printVersionComparison(repoRoot);
				return undefined;
			}
		}

		// Promote phase (for default and "promote" subcommand)
		const builtBinary = path.join(repoRoot, "packages", "coding-agent", "dist", "owp");
		try {
			await fs.access(builtBinary);
		} catch {
			if (subcommand === "promote") {
				ctx.ui.notify(
					"Built binary not found at packages/coding-agent/dist/owp. Run /install-binary build first.",
					"error",
				);
			} else {
				ctx.ui.notify(`Built binary not found at ${builtBinary}`, "error");
			}
			return;
		}

		const targetPath = explicitDest ? path.join(explicitDest, "owp") : await this.#resolveTargetPath(repoRoot);

		const targetDir = path.dirname(targetPath);
		try {
			await fs.mkdir(targetDir, { recursive: true });
		} catch {
			// ignore
		}

		// Atomic replace: write to a temp file, then rename. Avoids ETXTBSY
		// when the target is the currently-running binary.
		const tmpPath = `${targetPath}.tmp.${process.pid}`;
		await fs.copyFile(builtBinary, tmpPath);
		await fs.chmod(tmpPath, 0o755);
		await fs.rename(tmpPath, targetPath);

		// Verify promoted binary
		const verify = await execCommand(targetPath, ["--version"], repoRoot);
		if (verify.code === 0) {
			ctx.ui.notify(`Installed owp binary to ${targetPath} (${verify.stdout.trim()})`, "info");
		} else {
			ctx.ui.notify(`Installed owp binary to ${targetPath} (verification failed)`, "info");
		}

		return undefined;
	}

	async #build(
		repoRoot: string,
		buildScript: string,
		ctx: { ui: { notify: (message: string, type: "info" | "error") => void } },
	): Promise<boolean> {
		// Check if native addon is already at the expected version
		const nativeOk = await this.#checkNativeAddonVersion(repoRoot, ctx);
		if (nativeOk) {
			ctx.ui.notify("Native addon up to date, skipping rebuild", "info");
		} else {
			ctx.ui.notify("Building native addon... (this may take a few minutes)", "info");
			const nativeResult = await execCommand("bun", ["--cwd=packages/natives", "run", "build"], repoRoot);
			if (nativeResult.code !== 0) {
				ctx.ui.notify(`Native build failed:\n${nativeResult.stderr || ""}`, "error");
				return false;
			}
		}

		ctx.ui.notify("Building owp binary... (this may take a minute)", "info");
		const result = await execCommand("bun", ["run", buildScript], repoRoot);
		if (result.code !== 0) {
			ctx.ui.notify(`Build failed:\n${result.stderr || ""}`, "error");
			return false;
		}

		return true;
	}

	async #checkNativeAddonVersion(
		repoRoot: string,
		ctx: { ui: { notify: (message: string, type: "info" | "error") => void } },
	): Promise<boolean> {
		try {
			// Read expected version from package.json
			const packageJsonPath = path.join(repoRoot, "packages", "natives", "package.json");
			const packageJson = (await Bun.file(packageJsonPath).json()) as { version: string };
			const expectedSentinel = `__piNativesV${packageJson.version.replace(/[^A-Za-z0-9]/g, "_")}`;

			// Determine platform-specific .node filenames
			const platformTag = `${process.platform}-${process.arch}`;
			const nativeDir = path.join(repoRoot, "packages", "natives", "native");

			// x64 has modern and baseline variants; others have a single file
			const candidates =
				process.arch === "x64"
					? [
							{ variant: "modern", filename: `pi_natives.${platformTag}-modern.node` },
							{ variant: "baseline", filename: `pi_natives.${platformTag}-baseline.node` },
						]
					: [{ variant: "default", filename: `pi_natives.${platformTag}.node` }];

			// Check each existing candidate contains the expected sentinel
			// Only check variants that actually exist on disk
			let anyChecked = false;
			for (const candidate of candidates) {
				const candidatePath = path.join(nativeDir, candidate.filename);
				try {
					const file = Bun.file(candidatePath);
					if (!(await file.exists())) continue;

					// Check if the file contains the expected sentinel
					// The sentinel is exported as a JS function name, so it appears as plain text
					const text = await file.text();
					if (!text.includes(expectedSentinel)) {
						ctx.ui.notify(
							`Native addon ${candidate.filename} has version mismatch (expected ${expectedSentinel})`,
							"info",
						);
						return false;
					}
					anyChecked = true;
				} catch {
					// Can't read → treat as stale
					return false;
				}
			}

			// If no variants exist, we need to build
			if (!anyChecked) {
				ctx.ui.notify("No native addon variants found", "info");
				return false;
			}

			return true;
		} catch {
			// If we can't determine version, rebuild to be safe
			return false;
		}
	}

	async #printVersionComparison(repoRoot: string): Promise<void> {
		const localBinary = path.join(repoRoot, "packages", "coding-agent", "dist", "owp");
		let localVersion = "unknown";
		try {
			const v = await execCommand(localBinary, ["--version"], repoRoot);
			if (v.code === 0) localVersion = v.stdout.trim();
		} catch {
			/* ignore */
		}

		// Check for an existing global binary
		let globalPath: string | undefined;
		for (const name of ["owp", "omp"]) {
			const found = $which(name, { cache: WhichCachePolicy.Bypass });
			if (found && !found.startsWith(repoRoot + path.sep)) {
				try {
					const content = await Bun.file(found).text();
					if (!content.startsWith("#!")) {
						globalPath = found;
						break;
					}
				} catch {
					globalPath = found;
					break;
				}
			}
		}

		if (globalPath) {
			let globalVersion = "unknown";
			try {
				const v = await execCommand(globalPath, ["--version"], repoRoot);
				if (v.code === 0) globalVersion = v.stdout.trim();
			} catch {
				/* ignore */
			}
			// Output for the LLM to relay
			console.log(`Local:  ${localBinary} (${localVersion})`);
			console.log(`Global: ${globalPath} (${globalVersion})`);
			console.log("Run /install-binary promote to replace the global binary.");
		} else {
			console.log(`Local: ${localBinary} (${localVersion})`);
			console.log("No global owp binary found on PATH.");
			console.log("Run /install-binary promote to install globally.");
		}
	}

	async #findRepoRoot(): Promise<string | undefined> {
		// Start from the API cwd and walk up looking for the repo
		let dir = path.resolve(this.api.cwd);
		while (dir !== path.dirname(dir)) {
			try {
				await fs.access(path.join(dir, ".git"));
				// Additional check: verify it looks like oh-wiblo-pi
				await fs.access(path.join(dir, "packages", "coding-agent"));
				return dir;
			} catch {
				dir = path.dirname(dir);
			}
		}
		return undefined;
	}

	async #resolveTargetPath(repoRoot: string): Promise<string> {
		// Prefer updating an existing owp or omp binary location,
		// skipping shell scripts and anything inside the repo.
		for (const name of ["owp", "omp"]) {
			const existing = $which(name, { cache: WhichCachePolicy.Bypass });
			if (!existing) continue;
			// Skip if inside the repo
			if (existing.startsWith(repoRoot + path.sep)) continue;
			// Skip shell scripts
			try {
				const content = await Bun.file(existing).text();
				if (content.startsWith("#!")) continue;
			} catch {
				// Can't read as text → it's a binary
			}
			return existing;
		}
		// Default to ~/.local/bin/owp
		const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
		return path.join(home, ".local", "bin", "owp");
	}
}
