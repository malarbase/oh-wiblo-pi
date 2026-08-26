import * as Diff from "diff";
import { generateDiffString } from "../edit/diff";
import type { FileReadCache } from "../edit/file-read-cache";
import { HashlineMismatchError } from "./anchors";
import { applyEdits, applyHashlineEdits } from "./apply";
import { RECOVERY_EXTERNAL_WARNING, RECOVERY_SESSION_CHAIN_WARNING, RECOVERY_SESSION_REPLAY_WARNING } from "./messages";
import type { Snapshot, SnapshotStore } from "./snapshots";
import type { Anchor, ApplyResult, Edit, HashlineApplyOptions, HashlineApplyResult, HashlineEdit } from "./types";

export interface HashlineRecoveryArgs {
	cache: FileReadCache;
	absolutePath: string;
	currentText: string;
	edits: HashlineEdit[];
	options: HashlineApplyOptions;
}

export interface HashlineRecoveryResult {
	lines: string;
	firstChangedLine: number | undefined;
	warnings: string[];
}

const HASHLINE_RECOVERY_FUZZ_FACTOR = 3;

const HASHLINE_RECOVERY_WARNING =
	"Recovered from stale anchors using a previous read snapshot (file changed externally between read and edit).";

/**
 * Attempt to recover from a `HashlineMismatchError` by replaying the edits
 * against a cached pre-edit snapshot of the file and 3-way-merging the result
 * onto the current on-disk content. Returns `null` when no recovery is
 * possible.
 */
export function tryRecoverHashlineWithCache(args: HashlineRecoveryArgs): HashlineRecoveryResult | null {
	const { cache, absolutePath, currentText, edits, options } = args;
	const snapshot = cache.get(absolutePath);
	if (!snapshot || snapshot.lines.size === 0) return null;

	const overlaid = currentText.split("\n");
	let maxCachedLine = 0;
	for (const lineNum of snapshot.lines.keys()) {
		if (lineNum > maxCachedLine) maxCachedLine = lineNum;
	}
	while (overlaid.length < maxCachedLine) overlaid.push("");
	for (const [lineNum, content] of snapshot.lines) {
		overlaid[lineNum - 1] = content;
	}
	const previousText = overlaid.join("\n");
	if (previousText === currentText) return null;

	let applied: HashlineApplyResult;
	try {
		applied = applyHashlineEdits(previousText, edits, options);
	} catch (err) {
		if (err instanceof HashlineMismatchError) return null;
		throw err;
	}
	if (applied.lines === previousText) return null;

	const patch = Diff.structuredPatch("file", "file", previousText, applied.lines, "", "", { context: 3 });
	const merged = Diff.applyPatch(currentText, patch, { fuzzFactor: HASHLINE_RECOVERY_FUZZ_FACTOR });
	if (typeof merged !== "string" || merged === currentText) return null;

	const mergedDiff = generateDiffString(currentText, merged);
	const recoveryWarnings = [HASHLINE_RECOVERY_WARNING, ...(applied.warnings ?? [])];

	return {
		lines: merged,
		firstChangedLine: mergedDiff.firstChangedLine ?? applied.firstChangedLine,
		warnings: recoveryWarnings,
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// Upstream Recovery class
// ═══════════════════════════════════════════════════════════════════════════

export interface RecoveryArgs {
	path: string;
	currentText: string;
	fileHash: string;
	edits: readonly Edit[];
}

export interface RecoveryResult {
	/** Post-recovery text. */
	text: string;
	/** First changed line (1-indexed) relative to the live `currentText`, or `undefined`. */
	firstChangedLine: number | undefined;
	/** Warnings collected during recovery, including the user-facing recovery banner. */
	warnings: string[];
}

// Section tags are line-precise; never let Diff.applyPatch slide a hunk
// onto a duplicate closer 100+ lines away. If snapshot replay does not
// align exactly, refuse and let the caller re-read.
const RECOVERY_FUZZ_FACTOR = 0;

function applyEditsToSnapshot(
	previousText: string,
	currentText: string,
	edits: readonly Edit[],
	recoveryWarning: string,
): RecoveryResult | null {
	let applied: ApplyResult;
	try {
		applied = applyEdits(previousText, [...edits]);
	} catch {
		return null;
	}
	if (applied.text === previousText) return null;

	const patch = Diff.structuredPatch("file", "file", previousText, applied.text, "", "", { context: 3 });
	const merged = Diff.applyPatch(currentText, patch, { fuzzFactor: RECOVERY_FUZZ_FACTOR });
	if (typeof merged !== "string" || merged === currentText) return null;

	const firstChangedLine = findFirstChangedLine(currentText, merged) ?? applied.firstChangedLine;
	const hasNetChange = firstChangedLine !== undefined;
	const warnings = hasNetChange ? [recoveryWarning, ...(applied.warnings ?? [])] : [...(applied.warnings ?? [])];

	return { text: merged, firstChangedLine, warnings };
}

function collectAnchorLines(edits: readonly Edit[]): number[] {
	const lines: number[] = [];
	for (const edit of edits) {
		for (const anchor of getEditAnchors(edit)) lines.push(anchor.line);
	}
	return lines;
}

function getEditAnchors(edit: Edit): Anchor[] {
	if (edit.kind === "delete") return [edit.anchor];
	// Recovery only ever receives already-resolved edits (no `block`); this arm
	// exists for type-exhaustiveness over the full `Edit` union.
	if (edit.kind === "block") return [edit.anchor];
	return edit.cursor.kind === "before_anchor" || edit.cursor.kind === "after_anchor" ? [edit.cursor.anchor] : [];
}

function verifyAnchorContent(previousText: string, currentText: string, edits: readonly Edit[]): boolean {
	const lines = collectAnchorLines(edits);
	if (lines.length === 0) return true;
	const prev = previousText.split("\n");
	const curr = currentText.split("\n");
	for (const line of lines) {
		const idx = line - 1;
		if (idx < 0 || idx >= prev.length || idx >= curr.length) return false;
		if (prev[idx] !== curr[idx]) return false;
	}
	return true;
}

function replaySessionChainOnCurrent(
	previousText: string,
	currentText: string,
	edits: readonly Edit[],
): RecoveryResult | null {
	if (previousText.split("\n").length !== currentText.split("\n").length) return null;
	if (!verifyAnchorContent(previousText, currentText, edits)) return null;
	let applied: ApplyResult;
	try {
		applied = applyEdits(currentText, [...edits]);
	} catch {
		return null;
	}
	if (applied.text === currentText) return null;
	return {
		text: applied.text,
		firstChangedLine: applied.firstChangedLine,
		warnings: [RECOVERY_SESSION_REPLAY_WARNING, ...(applied.warnings ?? [])],
	};
}

function findFirstChangedLine(a: string, b: string): number | undefined {
	if (a === b) return undefined;
	const aLines = a.split("\n");
	const bLines = b.split("\n");
	const max = Math.max(aLines.length, bLines.length);
	for (let i = 0; i < max; i++) {
		if (aLines[i] !== bLines[i]) return i + 1;
	}
	return undefined;
}

function isHeadSnapshot(head: Snapshot | null, snapshot: Snapshot): boolean {
	return head === snapshot;
}

/**
 * Stateless recovery driver over a {@link SnapshotStore}. Construct once and
 * call {@link Recovery.tryRecover} per stale-tag incident. The default
 * implementation tries two strategies in order:
 *
 * 1. Apply the edits on the full-file version the tag names, then 3-way-merge
 *    the resulting patch onto the live content (handles external writes).
 * 2. (Session chain) If that version wasn't the head, replay the edits onto
 *    the live content directly when line counts match AND every edit's anchor
 *    line content is unchanged between version and current — a prior in-session
 *    edit advanced the tag and the model's anchors still name the same logical
 *    rows. Emits a dedicated {@link RECOVERY_SESSION_REPLAY_WARNING} because
 *    even with both guards a coincidental insert+delete pair on duplicate rows
 *    can still land the edit on the wrong row; see {@link replaySessionChainOnCurrent}.
 */
export class Recovery {
	constructor(readonly store: SnapshotStore) {}
	/**
	 * Attempt recovery. Returns `null` when no path forward is found — the
	 * caller should then surface a {@link MismatchError}.
	 */
	tryRecover(args: RecoveryArgs): RecoveryResult | null {
		const { path, currentText, fileHash, edits } = args;
		const snapshot = this.store.byHash(path, fileHash);
		if (!snapshot) return null;
		const isHead = isHeadSnapshot(this.store.head(path), snapshot);
		const recoveryWarning = isHead ? RECOVERY_EXTERNAL_WARNING : RECOVERY_SESSION_CHAIN_WARNING;
		const merged = applyEditsToSnapshot(snapshot.text, currentText, edits, recoveryWarning);
		if (merged !== null) return merged;
		// Session-chain fallback: the 3-way merge on the version refused.
		// Replay onto current is gated by line-count equality AND
		// anchor-content alignment — see `replaySessionChainOnCurrent`
		// for why both guards together still don't fully prove correctness.
		if (!isHead) return replaySessionChainOnCurrent(snapshot.text, currentText, edits);
		return null;
	}
}
