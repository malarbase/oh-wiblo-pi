/**
 * Random sound selector with no-repeat + debounce, per the CESP spec.
 */

import type { ResolvedSound } from "./pack.ts";

export interface PickerState {
	lastChosen: Map<string, number>;
	lastPlayedAt: Map<string, number>;
}

export function createPickerState(): PickerState {
	return { lastChosen: new Map(), lastPlayedAt: new Map() };
}

export interface PickOptions {
	debounceMs?: number;
	random?: () => number;
	now?: () => number;
}

export function pickSound(
	state: PickerState,
	packName: string,
	category: string,
	candidates: ResolvedSound[],
	opts: PickOptions = {},
): ResolvedSound | null {
	if (candidates.length === 0) return null;
	const debounceMs = opts.debounceMs ?? 500;
	const now = opts.now ? opts.now() : Date.now();
	const random = opts.random ?? Math.random;
	const key = `${packName}::${category}`;

	const previous = state.lastPlayedAt.get(key);
	if (previous !== undefined && now - previous < debounceMs) {
		return null;
	}

	let pool = candidates;
	const lastIdx = state.lastChosen.get(key);
	if (
		candidates.length > 1 &&
		typeof lastIdx === "number" &&
		lastIdx >= 0 &&
		lastIdx < candidates.length
	) {
		pool = candidates.filter((_, i) => i !== lastIdx);
	}

	const idx = Math.min(Math.floor(random() * pool.length), pool.length - 1);
	const chosen = pool[idx]!;
	const originalIdx = candidates.indexOf(chosen);
	state.lastChosen.set(key, originalIdx);
	state.lastPlayedAt.set(key, now);
	return chosen;
}
