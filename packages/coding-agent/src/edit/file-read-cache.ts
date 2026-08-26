/**
 * Per-session cache of file contents as they were rendered to the model by
 * the `read` and `search` tools in the current agent session.
 */
import { LRUCache } from "@oh-my-pi/pi-utils/lru";
import type { ToolSession } from "../tools";

const MAX_PATHS_PER_SESSION = 30;

export interface FileReadSnapshot {
	lines: Map<number, string>;
	recordedAt: number;
}

export class FileReadCache {
	#snapshots = new LRUCache<string, FileReadSnapshot>({ max: MAX_PATHS_PER_SESSION });

	get(absPath: string): FileReadSnapshot | null {
		return this.#snapshots.get(absPath) ?? null;
	}

	recordContiguous(absPath: string, startLine: number, lines: readonly string[]): void {
		if (lines.length === 0) return;
		const entries: Array<readonly [number, string]> = lines.map((line, idx) => [startLine + idx, line] as const);
		this.#record(absPath, entries);
	}

	recordSparse(absPath: string, entries: Iterable<readonly [number, string]>): void {
		const arr = Array.from(entries);
		if (arr.length === 0) return;
		this.#record(absPath, arr);
	}

	invalidate(absPath: string): void {
		this.#snapshots.delete(absPath);
	}

	clear(): void {
		this.#snapshots.clear();
	}

	#record(absPath: string, entries: ReadonlyArray<readonly [number, string]>): void {
		const existing = this.#snapshots.get(absPath);
		if (existing && hasConflict(existing.lines, entries)) {
			this.#snapshots.set(absPath, { lines: new Map(entries), recordedAt: Date.now() });
			return;
		}
		if (existing) {
			for (const [lineNum, content] of entries) existing.lines.set(lineNum, content);
			existing.recordedAt = Date.now();
			return;
		}
		this.#snapshots.set(absPath, { lines: new Map(entries), recordedAt: Date.now() });
	}
}

function hasConflict(existing: Map<number, string>, incoming: ReadonlyArray<readonly [number, string]>): boolean {
	for (const [lineNum, content] of incoming) {
		const prior = existing.get(lineNum);
		if (prior !== undefined && prior !== content) return true;
	}
	return false;
}

export function getFileReadCache(session: ToolSession): FileReadCache {
	if (!session.fileReadCache) session.fileReadCache = new FileReadCache();
	return session.fileReadCache;
}
