/**
 * CESP (Coding Event Sound Pack) manifest loading + resolution.
 *
 * Pure Node — no pi imports here.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { packDir as getPackDir, packManifestPath as getPackManifestPath, packsDir as getPacksDir } from "./paths.ts";

/** Canonical CESP event categories. */
export const CESP_CATEGORIES = [
	"session.start",
	"task.acknowledge",
	"task.complete",
	"task.error",
	"input.required",
	"resource.limit",
	"user.spam",
	"session.end",
	"task.progress",
] as const;
export type CespCategory = (typeof CESP_CATEGORIES)[number];

/** Raw sound entry as it appears in the manifest. */
export interface ManifestSound {
	file: string;
	label?: string;
	sha256?: string;
}

/** Manifest shape — per the actual CESP JSON: each category is an object with a `sounds` array. */
export interface CategoryEntry {
	sounds: ManifestSound[];
}

export interface PackManifest {
	name: string;
	displayName?: string;
	categories?: Record<string, CategoryEntry>;
	version?: string;
}

/** Loaded pack record — includes resolved on-disk root for playback. */
export interface InstalledPack {
	name: string;
	displayName: string;
	root: string;
	manifest: PackManifest;
}

/** Resolved sound for playback — absolute file path + display label. */
export interface ResolvedSound {
	file: string;
	label: string;
	absPath: string;
}

/** Read + sanity-check `openpeon.json` for the named pack. */
export function loadPack(name: string): InstalledPack | null {
	const jsonPath = getPackManifestPath(name);
	if (!existsSync(jsonPath)) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
	} catch {
		return null;
	}
	if (!raw || typeof raw !== "object") return null;
	const manifest = raw as PackManifest;
	if (!manifest.name || typeof manifest.name !== "string") return null;
	return {
		name: manifest.name,
		displayName: manifest.displayName || manifest.name,
		root: getPackDir(name),
		manifest,
	};
}

/** Enumerate installed packs. */
export function listInstalledPacks(): InstalledPack[] {
	const root = getPacksDir();
	if (!existsSync(root)) return [];
	const names = readdirSync(root);
	const packs: InstalledPack[] = [];
	for (const name of names) {
		const loaded = loadPack(name);
		if (loaded) packs.push(loaded);
	}
	return packs.sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve sounds for a category from the pack manifest. */
export function resolveCategory(
	pack: InstalledPack,
	category: string,
): ResolvedSound[] {
	const entry = pack.manifest.categories?.[category];
	if (entry?.sounds && entry.sounds.length > 0) {
		return entry.sounds.map((s) => mapSound(pack, s, category));
	}
	return [];
}

function mapSound(
	pack: InstalledPack,
	sound: ManifestSound,
	_resolvedCategory: string,
): ResolvedSound {
	const rel = sound.file.includes("/") ? sound.file : `sounds/${sound.file}`;
	return {
		file: sound.file,
		label: sound.label || sound.file,
		absPath: join(pack.root, ...rel.split("/")),
	};
}
