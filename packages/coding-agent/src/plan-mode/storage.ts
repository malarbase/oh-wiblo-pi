import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent } from "@oh-my-pi/pi-utils";
import { resolveLocalUrlToPath } from "../internal-urls";

export type PlanStorage = "session" | "project";

export interface PlanStorageContext {
	cwd: string;
	getArtifactsDir: () => string | null;
	getSessionId: () => string | null;
}

export interface SavedPlan {
	/** Stem without .md */
	name: string;
	/** Display title — same as name today; reserved for future frontmatter */
	title: string;
	location: "project" | "session";
	absolutePath: string;
	/** local:// URL for session plans, absolute path for project plans */
	url: string;
	mtime: Date;
}

/** Returns where the approved plan should be finalized. */
export function getFinalPlanPath(storage: PlanStorage, ctx: { cwd: string }, fileName: string): string {
	if (storage === "project") {
		return path.resolve(ctx.cwd, ".omp", "plans", fileName);
	}
	return `local://${fileName}`;
}

/**
 * Lists all saved plans across project + session locations, sorted by mtime desc.
 * Excludes the in-progress `PLAN.md` draft.
 */
export async function listSavedPlans(ctx: PlanStorageContext): Promise<SavedPlan[]> {
	const plans: SavedPlan[] = [];

	// Project plans: <cwd>/.omp/plans/*.md
	const projectDir = path.resolve(ctx.cwd, ".omp", "plans");
	try {
		const entries = await fs.readdir(projectDir);
		for (const entry of entries) {
			if (!entry.endsWith(".md")) continue;
			const absolutePath = path.join(projectDir, entry);
			try {
				const stat = await fs.stat(absolutePath);
				if (!stat.isFile()) continue;
				const name = entry.slice(0, -3);
				plans.push({
					name,
					title: name,
					location: "project",
					absolutePath,
					url: absolutePath,
					mtime: stat.mtime,
				});
			} catch {
				// ignore stat failures on individual entries
			}
		}
	} catch (err) {
		if (!isEnoent(err)) throw err;
	}

	// Session plans: <artifactsDir>/local/*.md, excluding PLAN.md (in-progress draft)
	const artifactsDir = ctx.getArtifactsDir();
	if (artifactsDir) {
		const sessionLocalDir = path.join(artifactsDir, "local");
		try {
			const entries = await fs.readdir(sessionLocalDir);
			for (const entry of entries) {
				if (!entry.endsWith(".md")) continue;
				if (entry === "PLAN.md") continue;
				const absolutePath = path.join(sessionLocalDir, entry);
				try {
					const stat = await fs.stat(absolutePath);
					if (!stat.isFile()) continue;
					const name = entry.slice(0, -3);
					plans.push({
						name,
						title: name,
						location: "session",
						absolutePath,
						url: `local://${entry}`,
						mtime: stat.mtime,
					});
				} catch {
					// ignore stat failures on individual entries
				}
			}
		} catch (err) {
			if (!isEnoent(err)) throw err;
		}
	}

	plans.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
	return plans;
}

/**
 * Resolves a plan name/path/URL to a SavedPlan; returns null if not found.
 *
 * Accepts:
 * - Bare stem like "FOO_PLAN" → searches project first, then session; throws on ambiguity
 * - Absolute path → use directly (must exist)
 * - `local://` URL → resolve via session's local root
 * - Relative path containing "/" → resolve against cwd
 */
export async function resolveSavedPlan(name: string, ctx: PlanStorageContext): Promise<SavedPlan | null> {
	const trimmed = name.trim();
	if (!trimmed) return null;

	// Absolute path
	if (path.isAbsolute(trimmed)) {
		try {
			const stat = await fs.stat(trimmed);
			if (!stat.isFile()) return null;
			const basename = path.basename(trimmed);
			const stem = basename.endsWith(".md") ? basename.slice(0, -3) : basename;
			return {
				name: stem,
				title: stem,
				location: "project",
				absolutePath: trimmed,
				url: trimmed,
				mtime: stat.mtime,
			};
		} catch {
			return null;
		}
	}

	// local:// URL
	if (trimmed.startsWith("local://") || trimmed.startsWith("local:/")) {
		const resolvedPath = resolveLocalUrlToPath(trimmed, {
			getArtifactsDir: ctx.getArtifactsDir,
			getSessionId: ctx.getSessionId,
		});
		try {
			const stat = await fs.stat(resolvedPath);
			if (!stat.isFile()) return null;
			const basename = path.basename(resolvedPath);
			const stem = basename.endsWith(".md") ? basename.slice(0, -3) : basename;
			return {
				name: stem,
				title: stem,
				location: "session",
				absolutePath: resolvedPath,
				url: trimmed,
				mtime: stat.mtime,
			};
		} catch {
			return null;
		}
	}

	// Relative path containing "/" → resolve against cwd
	if (trimmed.includes("/")) {
		const absolutePath = path.resolve(ctx.cwd, trimmed);
		try {
			const stat = await fs.stat(absolutePath);
			if (!stat.isFile()) return null;
			const basename = path.basename(absolutePath);
			const stem = basename.endsWith(".md") ? basename.slice(0, -3) : basename;
			return {
				name: stem,
				title: stem,
				location: "project",
				absolutePath,
				url: absolutePath,
				mtime: stat.mtime,
			};
		} catch {
			return null;
		}
	}

	// Bare stem → search both locations, project first; throw on ambiguity
	const fileName = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
	const stemName = fileName.slice(0, -3);

	const projectPath = path.resolve(ctx.cwd, ".omp", "plans", fileName);
	let projectExists = false;
	let projectMtime: Date | undefined;
	try {
		const stat = await fs.stat(projectPath);
		projectExists = stat.isFile();
		projectMtime = stat.mtime;
	} catch {
		// not found
	}

	let sessionPath: string | undefined;
	let sessionExists = false;
	let sessionMtime: Date | undefined;
	const artifactsDir = ctx.getArtifactsDir();
	if (artifactsDir) {
		sessionPath = path.join(artifactsDir, "local", fileName);
		try {
			const stat = await fs.stat(sessionPath);
			sessionExists = stat.isFile();
			sessionMtime = stat.mtime;
		} catch {
			// not found
		}
	}

	if (projectExists && sessionExists) {
		throw new Error(
			`Ambiguous plan name "${stemName}": found in both project (.omp/plans/${fileName}) and session. Use an absolute path or local:// URL to disambiguate.`,
		);
	}

	if (projectExists) {
		return {
			name: stemName,
			title: stemName,
			location: "project",
			absolutePath: projectPath,
			url: projectPath,
			mtime: projectMtime!,
		};
	}

	if (sessionExists && sessionPath) {
		return {
			name: stemName,
			title: stemName,
			location: "session",
			absolutePath: sessionPath,
			url: `local://${fileName}`,
			mtime: sessionMtime!,
		};
	}

	return null;
}

/**
 * Derives a plan filename stem from plan content.
 * Extracts the first # heading, converts to SCREAMING_SNAKE_CASE,
 * strips non-alphanumeric chars, and deduplicates against existingNames.
 * Falls back to "PLAN" if no heading found.
 * Appends _2, _3, ... if the name already exists.
 */
export function derivePlanName(content: string, existingNames: Set<string>): string {
	const match = /^#\s+(.+)/m.exec(content);
	let base = "plan";
	if (match) {
		const cleaned = match[1]
			.replace(/[^a-zA-Z0-9 ]/g, " ")
			.trim()
			.toLowerCase()
			.replace(/[\s_]+/g, "_");
		if (cleaned.length > 0 && cleaned !== "_") {
			base = cleaned;
		}
	}
	if (!existingNames.has(base)) return base;
	for (let i = 2; i <= 99; i++) {
		const candidate = `${base}_${i}`;
		if (!existingNames.has(candidate)) return candidate;
	}
	return `${base}_${Date.now()}`;
}
