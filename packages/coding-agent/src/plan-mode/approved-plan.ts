import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent } from "@oh-my-pi/pi-utils";
import { resolveLocalUrlToPath } from "../internal-urls";
import { normalizeLocalScheme } from "../tools/path-utils";

interface RenameApprovedPlanFileOptions {
	planFilePath: string;
	finalPlanFilePath: string;
	getArtifactsDir: () => string | null;
	getSessionId: () => string | null;
	/**
	 * When true, skip the destination-exists pre-check so the file is overwritten in place.
	 * Note: on POSIX, fs.rename silently replaces the destination. On Windows, fs.rename will
	 * fail if the destination exists — this is acceptable for v1 since plan storage is POSIX-first.
	 */
	overwrite?: boolean;
}

/**
 * Resolves a plan path that may be either a `local://` URL or an absolute filesystem path.
 * Relative non-`local:` paths are rejected.
 */
function resolvePlanLikePath(
	planPath: string,
	label: "source" | "destination",
	options: { getArtifactsDir: () => string | null; getSessionId: () => string | null },
): string {
	const normalized = normalizeLocalScheme(planPath);
	if (normalized.startsWith("local:")) {
		return resolveLocalUrlToPath(normalized, options);
	}
	if (path.isAbsolute(planPath)) {
		return planPath;
	}
	throw new Error(
		`Approved plan ${label} path must use local: scheme or be an absolute filesystem path (received ${planPath}).`,
	);
}

export async function renameApprovedPlanFile(options: RenameApprovedPlanFileOptions): Promise<void> {
	const { planFilePath, finalPlanFilePath, getArtifactsDir, getSessionId } = options;

	const resolveOptions = {
		getArtifactsDir: () => getArtifactsDir(),
		getSessionId: () => getSessionId(),
	};
	const resolvedSource = resolvePlanLikePath(planFilePath, "source", resolveOptions);
	const resolvedDestination = resolvePlanLikePath(finalPlanFilePath, "destination", resolveOptions);

	if (resolvedSource === resolvedDestination) {
		return;
	}

	if (!options.overwrite) {
		try {
			const destinationStat = await fs.stat(resolvedDestination);
			if (destinationStat.isFile()) {
				throw new Error(
					`Plan destination already exists at ${finalPlanFilePath}. Choose a different title and call exit_plan_mode again.`,
				);
			}
			throw new Error(`Plan destination exists but is not a file: ${finalPlanFilePath}`);
		} catch (error) {
			if (!isEnoent(error)) {
				throw error;
			}
		}
	}

	await fs.mkdir(path.dirname(resolvedDestination), { recursive: true });

	try {
		await fs.rename(resolvedSource, resolvedDestination);
	} catch (error) {
		// EXDEV: cross-device rename (different filesystem/mount point) — fall back to copy+unlink
		if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EXDEV") {
			try {
				await fs.copyFile(resolvedSource, resolvedDestination);
				await fs.unlink(resolvedSource);
			} catch (fallbackError) {
				throw new Error(
					`Failed to move approved plan from ${planFilePath} to ${finalPlanFilePath}: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
				);
			}
			return;
		}
		throw new Error(
			`Failed to rename approved plan from ${planFilePath} to ${finalPlanFilePath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
