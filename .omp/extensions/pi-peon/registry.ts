/**
 * CESP registry fetcher.
 */

export const REGISTRY_URL = "https://peonping.github.io/registry/index.json";

const FETCH_TIMEOUT_MS = 10_000;

export interface RegistryAuthor {
	name?: string;
	github?: string;
}

export interface RegistryEntry {
	name: string;
	display_name?: string;
	version?: string;
	description?: string;
	author?: RegistryAuthor;
	trust_tier?: string;
	categories?: string[];
	language?: string;
	license?: string;
	sound_count?: number;
	total_size_bytes?: number;
	source_repo: string;
	source_ref: string;
	source_path: string;
	tags?: string[];
}

interface RegistryFile {
	version?: number;
	packs?: unknown;
}

let cached: RegistryEntry[] | undefined;
let inFlight: Promise<RegistryEntry[]> | undefined;

export function resetRegistryCache(): void {
	cached = undefined;
	inFlight = undefined;
}

export async function fetchRegistry(): Promise<RegistryEntry[]> {
	if (cached) return cached;
	if (inFlight) return inFlight;

	inFlight = (async () => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		try {
			const res = await fetch(REGISTRY_URL, {
				signal: controller.signal,
				headers: { accept: "application/json" },
			});
			if (!res.ok) {
				throw new Error(`registry HTTP ${res.status}`);
			}
			const parsed = (await res.json()) as RegistryFile;
			if (!parsed || !Array.isArray(parsed.packs)) {
				throw new Error("registry: malformed (no `packs` array)");
			}
			const valid: RegistryEntry[] = [];
			for (const raw of parsed.packs as unknown[]) {
				const entry = validateEntry(raw);
				if (entry) valid.push(entry);
			}
			valid.sort((a, b) =>
				(a.display_name ?? a.name).localeCompare(b.display_name ?? b.name),
			);
			cached = valid;
			return valid;
		} finally {
			clearTimeout(timer);
			inFlight = undefined;
		}
	})();
	return inFlight;
}

function validateEntry(raw: unknown): RegistryEntry | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;
	if (typeof obj.name !== "string" || !obj.name.trim()) return null;
	if (typeof obj.source_repo !== "string" || !obj.source_repo.trim()) return null;
	if (typeof obj.source_ref !== "string" || !obj.source_ref.trim()) return null;
	const entry: RegistryEntry = {
		name: obj.name.trim(),
		source_repo: obj.source_repo.trim(),
		source_ref: obj.source_ref.trim(),
		source_path:
			typeof obj.source_path === "string" && obj.source_path.trim()
				? obj.source_path.trim()
				: ".",
	};
	if (typeof obj.display_name === "string") entry.display_name = obj.display_name;
	if (typeof obj.version === "string") entry.version = obj.version;
	if (typeof obj.description === "string") entry.description = obj.description;
	if (obj.author && typeof obj.author === "object") {
		const a = obj.author as Record<string, unknown>;
		entry.author = {
			name: typeof a.name === "string" ? a.name : undefined,
			github: typeof a.github === "string" ? a.github : undefined,
		};
	}
	if (typeof obj.trust_tier === "string") entry.trust_tier = obj.trust_tier;
	if (Array.isArray(obj.categories)) {
		entry.categories = obj.categories.filter((c): c is string => typeof c === "string");
	}
	if (typeof obj.language === "string") entry.language = obj.language;
	if (typeof obj.license === "string") entry.license = obj.license;
	if (typeof obj.sound_count === "number") entry.sound_count = obj.sound_count;
	if (typeof obj.total_size_bytes === "number") {
		entry.total_size_bytes = obj.total_size_bytes;
	}
	if (Array.isArray(obj.tags)) {
		entry.tags = obj.tags.filter((t): t is string => typeof t === "string");
	}
	return entry;
}
