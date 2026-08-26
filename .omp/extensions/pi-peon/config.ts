/**
 * Persistent config for pi-peon (OWP fork).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { configPath, ensureStateDir } from "./paths.ts";
import { CESP_CATEGORIES, type CespCategory } from "./pack.ts";

export const DEFAULT_ACTIVE_PACK = "peon";
export const DEFAULT_VOLUME = 0.5;

export interface PeonConfig {
	activePack: string;
	muted: boolean;
	volume: number;
	enabledCategories: Partial<Record<CespCategory, boolean>>;
}

export function envDefaults(): PeonConfig {
	return {
		activePack: DEFAULT_ACTIVE_PACK,
		muted: false,
		volume: DEFAULT_VOLUME,
		enabledCategories: defaultEnabledMap(),
	};
}

export function defaultEnabledMap(): Record<CespCategory, boolean> {
	const map = {} as Record<CespCategory, boolean>;
	for (const cat of CESP_CATEGORIES) map[cat] = true;
	return map;
}

function sanitize(raw: unknown): PeonConfig {
	const defaults = envDefaults();
	if (!raw || typeof raw !== "object") return defaults;
	const obj = raw as Record<string, unknown>;
	const cfg: PeonConfig = { ...defaults };

	if (typeof obj.activePack === "string" && obj.activePack.trim()) {
		cfg.activePack = obj.activePack.trim();
	}
	if (typeof obj.muted === "boolean") cfg.muted = obj.muted;
	if (typeof obj.volume === "number" && Number.isFinite(obj.volume)) {
		cfg.volume = clampVolume(obj.volume);
	}
	if (obj.enabledCategories && typeof obj.enabledCategories === "object") {
		const ec = obj.enabledCategories as Record<string, unknown>;
		const out: Partial<Record<CespCategory, boolean>> = {};
		for (const cat of CESP_CATEGORIES) {
			const v = ec[cat];
			out[cat] = typeof v === "boolean" ? v : true;
		}
		cfg.enabledCategories = out;
	}
	return cfg;
}

export function clampVolume(v: number): number {
	if (!Number.isFinite(v)) return DEFAULT_VOLUME;
	if (v < 0) return 0;
	if (v > 1) return 1;
	return v;
}

export function getConfigPath(): string {
	return configPath();
}

export function loadConfig(): PeonConfig {
	const p = configPath();
	try {
		if (!existsSync(p)) return envDefaults();
		return sanitize(JSON.parse(readFileSync(p, "utf-8")));
	} catch {
		return envDefaults();
	}
}

export function saveConfig(cfg: PeonConfig): void {
	ensureStateDir();
	const p = configPath();
	const out: Record<string, unknown> = {
		activePack: cfg.activePack,
		muted: cfg.muted,
		volume: clampVolume(cfg.volume),
		enabledCategories: { ...cfg.enabledCategories },
	};
	writeFileSync(p, JSON.stringify(out, null, 2) + "\n", "utf-8");
}

export function loadOrInitConfig(): PeonConfig {
	const p = configPath();
	if (!existsSync(p)) {
		const seeded = envDefaults();
		try { saveConfig(seeded); } catch { /* non-fatal */ }
		return seeded;
	}
	return loadConfig();
}

export function isCategoryEnabled(cfg: PeonConfig, cat: CespCategory): boolean {
	return cfg.enabledCategories[cat] !== false;
}
