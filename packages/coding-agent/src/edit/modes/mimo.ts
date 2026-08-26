/**
 * MiMo-Code edit mode for the edit tool.
 *
 * Replicates MiMo-Code's exact string replacement behavior:
 * - Exact match by default (no fuzzy)
 * - Optional fuzzy fallback chain (gated by edit.fuzzyMatch setting)
 * - MiMo-Code's parameter schema (file_path, old_string, new_string, replace_all)
 * - MiMo-Code's error messages and closest-match hints
 */

import { type } from "@oh-my-pi/omptype";
import type { AgentToolResult } from "@oh-my-pi/pi-agent-core";
import type { WritethroughCallback, WritethroughDeferredHandle } from "../../lsp";
import { enforceAskModeGuard } from "../../modes/ask-mode/ask-mode-guard";
import type { ToolSession } from "../../tools";
import { invalidateFsScanAfterWrite } from "../../tools/fs-cache-invalidation";
import { outputMeta } from "../../tools/output-meta";
import { enforcePlanModeWrite, resolvePlanPath } from "../../tools/plan-mode-guard";
import { generateDiffString } from "../diff";
import { detectLineEnding, normalizeToLF, restoreLineEndings, stripBom } from "../normalize";
import { readEditFileText, serializeEditFileText } from "../read-file";
import type { EditToolDetails, LspBatchRequest } from "../renderer";

// ═══════════════════════════════════════════════════════════════════════════
// Schema
// ═══════════════════════════════════════════════════════════════════════════

export const mimoEditSchema = type({
	file_path: type("string").describe("The absolute path to the file to modify"),
	old_string: type("string").describe("The text to replace"),
	new_string: type("string").describe("The text to replace it with (must be different from old_string)"),
	"replace_all?": type("boolean").describe("Replace all occurrences of old_string (default false)"),
});

export type MimoEditParams = typeof mimoEditSchema.infer;

// ═══════════════════════════════════════════════════════════════════════════
// Replacer Chain (ported from MiMo-Code)
// ═══════════════════════════════════════════════════════════════════════════

export type Replacer = (content: string, find: string) => Generator<string, void, unknown>;

/**
 * Levenshtein distance algorithm implementation.
 */
function levenshtein(a: string, b: string): number {
	if (a === "" || b === "") return Math.max(a.length, b.length);
	const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
		Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
	);
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
		}
	}
	return matrix[a.length][b.length];
}

function removeIndentation(text: string): string {
	return text
		.split("\n")
		.map(line => line.trimStart())
		.join("\n");
}

export const SimpleReplacer: Replacer = function* (_content, find) {
	yield find;
};

export const LineTrimmedReplacer: Replacer = function* (content, find) {
	const originalLines = content.split("\n");
	const searchLines = find.split("\n");
	if (searchLines[searchLines.length - 1] === "") searchLines.pop();

	for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
		let matches = true;
		for (let j = 0; j < searchLines.length; j++) {
			if (originalLines[i + j].trim() !== searchLines[j].trim()) {
				matches = false;
				break;
			}
		}
		if (matches) {
			let matchStartIndex = 0;
			for (let k = 0; k < i; k++) matchStartIndex += originalLines[k].length + 1;
			let matchEndIndex = matchStartIndex;
			for (let k = 0; k < searchLines.length; k++) {
				matchEndIndex += originalLines[i + k].length;
				if (k < searchLines.length - 1) matchEndIndex += 1;
			}
			yield content.substring(matchStartIndex, matchEndIndex);
		}
	}
};

export const BlockAnchorReplacer: Replacer = function* (content, find) {
	const findLines = find.split("\n");
	if (findLines.length < 2) return;

	const firstLine = findLines[0].trim();
	const lastLine = findLines[findLines.length - 1].trim();
	const normalizedFind = removeIndentation(find);

	const contentLines = content.split("\n");
	const candidates: Array<{ block: string; similarity: number }> = [];

	for (let i = 0; i < contentLines.length; i++) {
		if (contentLines[i].trim() !== firstLine) continue;
		for (let j = i + findLines.length - 1; j < contentLines.length; j++) {
			if (contentLines[j].trim() !== lastLine) continue;
			const block = contentLines.slice(i, j + 1).join("\n");
			const blockNormalized = removeIndentation(block);
			const dist = levenshtein(blockNormalized, normalizedFind);
			const maxLen = Math.max(blockNormalized.length, normalizedFind.length);
			const similarity = maxLen === 0 ? 1 : 1 - dist / maxLen;
			candidates.push({ block, similarity });
			break;
		}
	}

	if (candidates.length === 0) return;
	if (candidates.length === 1) {
		if (candidates[0].similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
			yield candidates[0].block;
		}
		return;
	}

	candidates.sort((a, b) => b.similarity - a.similarity);
	const best = candidates[0];
	const secondBest = candidates[1];
	if (best.similarity - secondBest.similarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD) {
		yield best.block;
	}
};

const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0;
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3;

export const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
	const normalizedFind = find.replace(/\s+/g, " ").trim();
	const lines = content.split("\n");
	const findLines = normalizedFind.split(" ");

	for (let i = 0; i <= lines.length - 1; i++) {
		const block = lines.slice(i, i + 1).join("\n");
		if (block.replace(/\s+/g, " ").trim() === normalizedFind) {
			yield block;
		}
	}

	// Multi-line: try collapsing whitespace across lines
	const contentBlocks = content.split("\n");
	for (let i = 0; i <= contentBlocks.length - findLines.length; i++) {
		const windowText = contentBlocks.slice(i, i + Math.max(1, findLines.length)).join(" ");
		if (windowText.replace(/\s+/g, " ").trim() === normalizedFind) {
			yield contentBlocks.slice(i, i + Math.max(1, findLines.length)).join("\n");
		}
	}
};

export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
	const findLines = find.split("\n");
	if (findLines.length === 0) return;

	const nonEmptyFindLines = findLines.filter(l => l.trim().length > 0);
	if (nonEmptyFindLines.length === 0) return;

	const firstNonEmpty = nonEmptyFindLines[0];
	const indentMatch = firstNonEmpty.match(/^(\s*)/);
	if (!indentMatch) return;
	const baseIndent = indentMatch[1];

	const normalizedFindLines = findLines.map(l => {
		if (l.trim().length === 0) return "";
		if (l.startsWith(baseIndent)) return l.slice(baseIndent.length);
		return l.trimStart();
	});
	const normalizedFind = normalizedFindLines.join("\n");

	const contentLines = content.split("\n");
	for (let i = 0; i <= contentLines.length - findLines.length; i++) {
		const block = contentLines.slice(i, i + findLines.length).join("\n");
		if (removeIndentation(block) === normalizedFind) {
			yield block;
		}
	}
};

export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
	const unescapeString = (str: string): string =>
		str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (_match, capturedChar: string) => {
			switch (capturedChar) {
				case "n":
					return "\n";
				case "t":
					return "\t";
				case "r":
					return "\r";
				case "'":
					return "'";
				case '"':
					return '"';
				case "`":
					return "`";
				case "\\":
					return "\\";
				case "\n":
					return "\n";
				case "$":
					return "$";
				default:
					return _match;
			}
		});

	const unescapedFind = unescapeString(find);
	if (content.includes(unescapedFind)) yield unescapedFind;

	const lines = content.split("\n");
	const findLines = unescapedFind.split("\n");
	for (let i = 0; i <= lines.length - findLines.length; i++) {
		const block = lines.slice(i, i + findLines.length).join("\n");
		if (unescapeString(block) === unescapedFind) yield block;
	}
};

export const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
	const trimmedFind = find.trim();
	if (trimmedFind === find) return;
	if (content.includes(trimmedFind)) yield trimmedFind;

	const lines = content.split("\n");
	const findLines = find.split("\n");
	for (let i = 0; i <= lines.length - findLines.length; i++) {
		const block = lines.slice(i, i + findLines.length).join("\n");
		if (block.trim() === trimmedFind) yield block;
	}
};

export const ContextAwareReplacer: Replacer = function* (content, find) {
	const findLines = find.split("\n");
	if (findLines.length < 3) return;
	if (findLines[findLines.length - 1] === "") findLines.pop();

	const contentLines = content.split("\n");
	const firstLine = findLines[0].trim();
	const lastLine = findLines[findLines.length - 1].trim();

	for (let i = 0; i < contentLines.length; i++) {
		if (contentLines[i].trim() !== firstLine) continue;
		for (let j = i + 2; j < contentLines.length; j++) {
			if (contentLines[j].trim() !== lastLine) continue;
			const blockLines = contentLines.slice(i, j + 1);
			if (blockLines.length === findLines.length) {
				let matchingLines = 0;
				let totalNonEmptyLines = 0;
				for (let k = 1; k < blockLines.length - 1; k++) {
					const blockLine = blockLines[k].trim();
					const findLine = findLines[k].trim();
					if (blockLine.length > 0 || findLine.length > 0) {
						totalNonEmptyLines++;
						if (blockLine === findLine) matchingLines++;
					}
				}
				if (totalNonEmptyLines === 0 || matchingLines / totalNonEmptyLines >= 0.5) {
					yield blockLines.join("\n");
					break;
				}
			}
			break;
		}
	}
};

export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
	let startIndex = 0;
	while (true) {
		const index = content.indexOf(find, startIndex);
		if (index === -1) break;
		yield find;
		startIndex = index + find.length;
	}
};

// ═══════════════════════════════════════════════════════════════════════════
// Core Replace Function
// ═══════════════════════════════════════════════════════════════════════════

const CLOSEST_MATCH_HINT_MAX_CHARS = 2000;

function buildNotFoundError(content: string, oldString: string): string {
	const base = `String to replace not found in file. It must match exactly, including whitespace, indentation, and line endings.\nString: ${oldString}`;
	const hint = findClosestMatch(content, oldString);
	if (!hint) return base;
	const truncated =
		hint.length > CLOSEST_MATCH_HINT_MAX_CHARS
			? `${hint.slice(0, CLOSEST_MATCH_HINT_MAX_CHARS)}\n... (truncated)`
			: hint;
	return `${base}\n\nClosest match found in file (note the exact whitespace / indentation / line endings — resubmit old_string copying this verbatim):\n${truncated}`;
}

function findClosestMatch(content: string, oldString: string): string | undefined {
	for (const replacer of [
		LineTrimmedReplacer,
		BlockAnchorReplacer,
		IndentationFlexibleReplacer,
		WhitespaceNormalizedReplacer,
		TrimmedBoundaryReplacer,
		EscapeNormalizedReplacer,
		ContextAwareReplacer,
	]) {
		for (const match of replacer(content, oldString)) {
			if (match && match !== oldString && content.includes(match)) return match;
		}
	}
	return undefined;
}

/**
 * MiMo-Code's replace function. Exact match by default; fuzzy fallback chain
 * when allowFuzzy is true.
 */
export function mimoReplace(
	content: string,
	oldString: string,
	newString: string,
	replaceAll: boolean,
	allowFuzzy: boolean,
): string {
	if (oldString === newString) {
		throw new Error("No changes to apply: old_string and new_string are identical.");
	}

	if (!allowFuzzy) {
		// Exact match only (MiMo-Code default)
		const firstIndex = content.indexOf(oldString);
		if (firstIndex === -1) throw new Error(buildNotFoundError(content, oldString));
		if (replaceAll) return content.replaceAll(oldString, newString);
		const matches = content.split(oldString).length - 1;
		if (matches > 1) {
			throw new Error(
				`Found ${matches} matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. To replace only one occurrence, provide more surrounding context to make the match unique.\nString: ${oldString}`,
			);
		}
		return content.substring(0, firstIndex) + newString + content.substring(firstIndex + oldString.length);
	}

	// Fuzzy fallback chain
	let notFound = true;
	for (const replacer of [
		SimpleReplacer,
		LineTrimmedReplacer,
		BlockAnchorReplacer,
		WhitespaceNormalizedReplacer,
		IndentationFlexibleReplacer,
		EscapeNormalizedReplacer,
		TrimmedBoundaryReplacer,
		ContextAwareReplacer,
		MultiOccurrenceReplacer,
	]) {
		for (const search of replacer(content, oldString)) {
			const index = content.indexOf(search);
			if (index === -1) continue;
			notFound = false;
			if (replaceAll) return content.replaceAll(search, newString);
			const lastIndex = content.lastIndexOf(search);
			if (index !== lastIndex) continue;
			return content.substring(0, index) + newString + content.substring(index + search.length);
		}
	}

	if (notFound) throw new Error(buildNotFoundError(content, oldString));
	throw new Error(
		`Found multiple matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. To replace only one occurrence, provide more surrounding context to make the match unique.\nString: ${oldString}`,
	);
}

// ═══════════════════════════════════════════════════════════════════════════
// Execute
// ═══════════════════════════════════════════════════════════════════════════

export interface ExecuteMimoSingleOptions {
	session: ToolSession;
	params: MimoEditParams;
	signal?: AbortSignal;
	batchRequest?: LspBatchRequest;
	allowFuzzy: boolean;
	writethrough: WritethroughCallback;
	beginDeferredDiagnosticsForPath: (path: string) => WritethroughDeferredHandle;
}

export async function executeMimoSingle(
	options: ExecuteMimoSingleOptions,
): Promise<AgentToolResult<EditToolDetails, typeof mimoEditSchema>> {
	const { session, params, signal, batchRequest, allowFuzzy, writethrough, beginDeferredDiagnosticsForPath } = options;
	const { file_path, old_string, new_string, replace_all } = params;

	const askBlock = enforceAskModeGuard(session, "edit", {
		path: file_path,
		old_text: old_string,
		new_text: new_string,
	});
	if (askBlock) return askBlock;

	// Normalize file_path to absolute (MiMo-Code supports relative paths)
	const displayPath = file_path;
	const absolutePath = path.isAbsolute(file_path) ? file_path : resolvePlanPath(session, file_path);
	enforcePlanModeWrite(session, absolutePath);

	// MiMo-Code: old_string === "" means create new file
	if (old_string === "") {
		const finalContent = new_string;
		const written = await serializeEditFileText(absolutePath, displayPath, finalContent);
		const diagnostics = await writethrough(
			absolutePath,
			written,
			signal,
			Bun.file(absolutePath),
			batchRequest,
			dst => (dst === absolutePath ? beginDeferredDiagnosticsForPath(absolutePath) : undefined),
		);
		invalidateFsScanAfterWrite(absolutePath);

		const meta = outputMeta()
			.diagnostics(diagnostics?.summary ?? "", diagnostics?.messages ?? [])
			.get();

		return {
			content: [{ type: "text", text: `File created: ${displayPath}` }],
			details: {
				diff: "",
				path: absolutePath,
				diagnostics,
				meta,
				oldText: "",
				newText: written,
			},
		};
	}

	const rawContent = await readEditFileText(absolutePath, displayPath);
	const { bom, text: content } = stripBom(rawContent);
	const originalEnding = detectLineEnding(content);
	const normalizedContent = normalizeToLF(content);
	const normalizedOldString = normalizeToLF(old_string);
	const normalizedNewString = normalizeToLF(new_string);

	const resultContent = mimoReplace(
		normalizedContent,
		normalizedOldString,
		normalizedNewString,
		replace_all ?? false,
		allowFuzzy,
	);

	if (normalizedContent === resultContent) {
		throw new Error(`Edits to ${displayPath} resulted in no changes being made.`);
	}

	const finalContent = await serializeEditFileText(
		absolutePath,
		displayPath,
		bom + restoreLineEndings(resultContent, originalEnding),
	);
	const diagnostics = await writethrough(
		absolutePath,
		finalContent,
		signal,
		Bun.file(absolutePath),
		batchRequest,
		dst => (dst === absolutePath ? beginDeferredDiagnosticsForPath(absolutePath) : undefined),
	);
	invalidateFsScanAfterWrite(absolutePath);

	const diffResult = generateDiffString(normalizedContent, resultContent);
	const count = (replace_all ?? false) ? normalizedContent.split(normalizedOldString).length - 1 : 1;
	const resultText =
		count > 1 ? `Successfully replaced ${count} occurrences in ${displayPath}.` : `Edit applied successfully.`;

	const meta = outputMeta()
		.diagnostics(diagnostics?.summary ?? "", diagnostics?.messages ?? [])
		.get();

	return {
		content: [{ type: "text", text: resultText }],
		details: {
			diff: diffResult.diff,
			path: absolutePath,
			firstChangedLine: diffResult.firstChangedLine,
			diagnostics,
			meta,
			oldText: rawContent,
			newText: finalContent,
		},
	};
}

// Need path for normalizePath
import * as path from "node:path";
