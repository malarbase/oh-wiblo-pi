/**
 * /install-binary — Build and/or promote the compiled owp binary.
 *
 * Invocation forms:
 *   /install-binary                   — build then promote (default)
 *   /install-binary build             — compile only
 *   /install-binary promote [dest]    — promote existing dist/owp
 *   /install-binary [dest]            — build then promote to explicit dest
 *
 * Destination resolution (promote / default):
 *   1. Explicit path from args
 *   2. First real owp binary outside the repo on PATH (skips shell scripts
 *      and dist/ entries inside the repo)
 *   3. Fallback: ~/.local/bin
 */

import { $ } from "bun";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { CustomCommand, CustomCommandAPI, HookCommandContext } from "@oh-my-pi/pi-coding-agent";
import { getAgentDir, logger } from "@oh-my-pi/pi-utils";

// ---------------------------------------------------------------------------
// Repo root detection
// ---------------------------------------------------------------------------

/**
 * Walk up from getAgentDir() to find the repo root (directory containing
 * packages/coding-agent/). Resolves to the directory that has
 * packages/coding-agent/dist/owp.
 */
async function findRepoRoot(): Promise<string | undefined> {
	// getAgentDir() is ~/.omp/agent; repo root is the cwd where owp was launched
	// from, OR we can find it by locating packages/coding-agent relative to the
	// agent dir's parent symlink chain. Simplest: search PATH for the script and
	// derive from it, or walk up from the known dist path.
	//
	// More reliably: search all owp candidates on PATH for shell scripts, extract
	// REPO_ROOT from the script content (the script sets REPO_ROOT explicitly).
	try {
		const result = await $`/usr/bin/which -a owp`.quiet().nothrow();
		if (result.exitCode !== 0) return undefined;
		for (const candidate of result.text().trim().split("\n").filter(Boolean)) {
			try {
				const content = await Bun.file(candidate).text();
				// The bin/owp script contains: REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
				// We can derive it: script lives at <repo>/bin/owp, so repo = dirname(dirname(script))
				if (content.includes("dist/owp") && content.includes("REPO_ROOT")) {
					return path.dirname(path.dirname(candidate));
				}
			} catch {
				// binary or unreadable — not the script
			}
		}
	} catch {
		// ignore
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Destination resolution
// ---------------------------------------------------------------------------

/**
 * Find the best destination directory for the promoted binary.
 * Skips shell scripts and anything inside the repo's own dist/.
 */
async function resolveDestination(repoRoot: string | undefined): Promise<string> {
	try {
		const result = await $`/usr/bin/which -a owp`.quiet().nothrow();
		if (result.exitCode === 0) {
			for (const candidate of result.text().trim().split("\n").filter(Boolean)) {
				// Skip if inside the repo
				if (repoRoot && candidate.startsWith(repoRoot + path.sep)) continue;
				// Skip shell scripts
				try {
					const content = await Bun.file(candidate).text();
					if (content.startsWith("#!")) continue; // shell script
				} catch {
					// Can't read as text → it's a binary
				}
				return path.dirname(candidate);
			}
		}
	} catch {
		// ignore
	}
	return path.join(os.homedir(), ".local", "bin");
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function runBuild(repoRoot: string, ctx: HookCommandContext): Promise<boolean> {
	ctx.ui.setStatus("install-binary", "Building owp...");

	const buildDir = path.join(repoRoot, "packages", "coding-agent");
	const result = await $`bun run build`.cwd(buildDir).nothrow();

	ctx.ui.setStatus("install-binary", undefined);

	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString().trim();
		ctx.ui.notify(`Build failed (exit ${result.exitCode})${stderr ? `:\n${stderr}` : ""}`, "error");
		logger.error("install-binary: build failed", { exitCode: result.exitCode, stderr });
		return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// Promote
// ---------------------------------------------------------------------------

async function runPromote(
	repoRoot: string,
	destDir: string,
	ctx: HookCommandContext,
): Promise<boolean> {
	const srcPath = path.join(repoRoot, "packages", "coding-agent", "dist", "owp");
	const destPath = path.join(destDir, "owp");

	// Verify source exists
	try {
		await fs.access(srcPath);
	} catch {
		ctx.ui.notify(
			`packages/coding-agent/dist/owp not found. Run /install-binary build first.`,
			"error",
		);
		return false;
	}

	ctx.ui.setStatus("install-binary", `Promoting to ${destPath}...`);

	// Ensure destination directory exists
	await fs.mkdir(destDir, { recursive: true });

	// Copy
	await fs.copyFile(srcPath, destPath);
	await fs.chmod(destPath, 0o755);

	// Codesign on macOS
	if (process.platform === "darwin") {
		const sign = await $`codesign --sign - --force ${destPath}`.quiet().nothrow();
		if (sign.exitCode !== 0) {
			ctx.ui.notify(`codesign failed — binary copied but not signed`, "warning");
		}
	}

	ctx.ui.setStatus("install-binary", undefined);

	// Verify
	const verify = await $`${destPath} --version`.quiet().nothrow();
	const version = verify.exitCode === 0 ? verify.text().trim() : "(version unknown)";

	ctx.ui.notify(
		`Promoted: packages/coding-agent/dist/owp → ${destPath}\nVersion: ${version}`,
		"info",
	);
	logger.info("install-binary: promoted", { destPath, version });
	return true;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

type Mode = "build" | "promote" | "default";

function parseArgs(args: string[]): { mode: Mode; destArg: string | undefined } {
	const raw = args.join(" ").trim();
	if (!raw) return { mode: "default", destArg: undefined };
	if (raw === "build" || raw.startsWith("build ")) {
		return { mode: "build", destArg: undefined };
	}
	if (raw === "promote" || raw.startsWith("promote ")) {
		const rest = raw.slice("promote".length).trim() || undefined;
		return { mode: "promote", destArg: rest };
	}
	return { mode: "default", destArg: raw };
}

// ---------------------------------------------------------------------------
// Command factory
// ---------------------------------------------------------------------------

export default function factory(_api: CustomCommandAPI): CustomCommand {
	return {
		name: "install-binary",
		description: "Build and/or promote the compiled owp binary",

		async execute(args: string[], ctx: HookCommandContext): Promise<undefined> {
			const { mode, destArg } = parseArgs(args);

			const repoRoot = await findRepoRoot();
			if (!repoRoot) {
				ctx.ui.notify(
					"Could not locate owp repo root. Ensure owp is on PATH via its bin/owp wrapper.",
					"error",
				);
				return;
			}

			// Build step
			if (mode === "build" || mode === "default") {
				const ok = await runBuild(repoRoot, ctx);
				if (!ok) return;

				// Print comparison
				const distOwp = path.join(repoRoot, "packages", "coding-agent", "dist", "owp");
				const localVer =
					(await $`${distOwp} --version`.quiet().nothrow()).text().trim() || "(version unknown)";
				const globalBin = (await $`which owp`.quiet().nothrow()).text().trim() || "(not on PATH)";
				const globalVer = (await $`owp --version`.quiet().nothrow()).text().trim() || "";

				ctx.ui.notify(
					[
						`Local:  packages/coding-agent/dist/owp  ${localVer}`,
						`Global: ${globalBin}  ${globalVer}`,
					].join("\n"),
					"info",
				);

				if (mode === "build") return;
			}

			// Promote step
			const destDir = destArg ?? (await resolveDestination(repoRoot));
			await runPromote(repoRoot, destDir, ctx);
		},
	};
}
