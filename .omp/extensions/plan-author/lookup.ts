import * as fs from "node:fs";
import * as path from "node:path";
import {
	type PlanCoordinates,
	type PlanReference,
	type PlanSignals,
	extractSignals,
	normalizePlanName,
	parseTranscriptFile,
	sessionIdFromFile,
} from "./transcript";

/** A plan on disk, mirroring the shape `listSavedPlans` in
 *  `packages/coding-agent/src/plan-mode/storage.ts` produces. That function is not
 *  exported from the package barrel, so this is a deliberate local mirror — keep the
 *  two in step if the storage layout ever changes. */
export type SavedPlan = {
	name: string;
	absolutePath: string;
	url: string;
	location: "project" | "session";
	mtimeMs: number;
};

/** One session transcript that mentions a plan, with the evidence for that mention. */
export type Candidate = {
	file: string;
	sessionId: string;
	signals: PlanSignals;
	mtimeMs: number;
};

/** Chunk size for the byte prefilter. Large enough to amortise the read, small enough that
 *  the straddle carry-over below stays negligible. */
const PREFILTER_CHUNK_BYTES = 1 << 20;

/** Substrings whose presence in a transcript proves it can be a candidate.
 *
 *  Case is preserved deliberately. Transcripts spell a plan name exactly as the host wrote
 *  it — `local://Deploy-the-Omnigent-server-to-the-Whiteblossom-cluster.md` keeps its
 *  capitals — so lowercasing the needles while the bytes stay mixed-case silently rejects
 *  the real author. Match what is literally on disk.
 *
 *  A plan is named on disk by its stem, but the stem appears in transcripts under several
 *  surface forms: the literal filename, the prose title it was slugified from, and the
 *  working slug the author used before the host renamed the file. Testing all of them keeps
 *  a false negative from dropping the author. */
export function planNeedles(coord: PlanCoordinates, extraTitles: string[] = []): string[] {
	const needles = new Set<string>();
	const add = (value: string | undefined): void => {
		const trimmed = value?.trim();
		if (trimmed && trimmed.length >= 4) needles.add(trimmed);
	};
	add(coord.stem);
	add(coord.stem.replaceAll("-", " "));
	add(coord.stem.replaceAll("-", "_"));
	add(coord.planBaseName);
	for (const title of extraTitles) {
		add(title);
		add(title.replace(/[^A-Za-z0-9]+/g, " "));
	}
	return [...needles];
}

/** True when the file's bytes contain any needle.
 *
 *  Searches raw bytes rather than a decoded string. A plan name is ASCII and transcripts are
 *  mostly JSON, so byte search is equivalent — but decoding 600 MB of chunks to UTF-8 first
 *  costs roughly 2.4× more than letting `Buffer.includes` run memmem over the same data.
 *
 *  Streams in chunks with a carry-over so a needle straddling a chunk boundary is still
 *  found, and never materialises the whole file. */
export async function fileMentionsAny(file: string, needles: string[]): Promise<boolean> {
	if (needles.length === 0) return false;
	const encoded = needles.map(needle => Buffer.from(needle, "utf-8"));
	const overlap = Math.max(...encoded.map(needle => needle.length)) - 1;
	if (overlap < 0) return false;
	try {
		const handle = Bun.file(file);
		const total = handle.size;
		if (total === 0) return false;
		let position = 0;
		let carry = Buffer.alloc(0);
		while (position < total) {
			const chunk = Buffer.from(await handle.slice(position, position + PREFILTER_CHUNK_BYTES).arrayBuffer());
			const window = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
			if (encoded.some(needle => window.includes(needle))) return true;
			carry = window.subarray(Math.max(0, window.length - overlap));
			position += PREFILTER_CHUNK_BYTES;
		}
		return false;
	} catch {
		return false;
	}
}

/** List saved plans newest-first: project plans under `<cwd>/.omp/plans`, then session plans
 *  under the artifacts `local/` root. Excludes the in-progress `PLAN.md` draft.
 *
 *  Synchronous by design. Argument completions are typed to return synchronously
 *  (`RegisteredCommand.getArgumentCompletions`), and this enumerates two directories and
 *  stats the markdown files inside them — a synchronous pair of directory reads is cheaper
 *  than maintaining a second, async-only implementation for the command path. */
export function listSavedPlans(cwd: string, artifactsDir: string | null): SavedPlan[] {
	const plans: SavedPlan[] = [];
	const collect = (dir: string, location: SavedPlan["location"]): void => {
		let entries: string[];
		try {
			entries = fs.readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (!entry.endsWith(".md") || entry === "PLAN.md") continue;
			const absolutePath = path.join(dir, entry);
			try {
				const stat = fs.statSync(absolutePath);
				if (!stat.isFile()) continue;
				plans.push({
					name: entry.slice(0, -3),
					absolutePath,
					url: location === "project" ? absolutePath : `local://${entry}`,
					location,
					mtimeMs: stat.mtimeMs,
				});
			} catch {
				// An individual stat failure must not abort the listing.
			}
		}
	};

	collect(path.resolve(cwd, ".omp", "plans"), "project");
	if (artifactsDir) collect(path.join(artifactsDir, "local"), "session");

	plans.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return plans;
}

/** Match a free-text stub against saved plans: exact stem, then case-insensitive substring
 *  on the stem. Deliberately substring-only — the caller decides what to do with several
 *  matches, so narrowing here would hide candidates the user may have meant. */
export function matchPlans(plans: SavedPlan[], query: string): SavedPlan[] {
	const trimmed = query.trim();
	if (!trimmed) return [];
	const withExtension = trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
	const stem = withExtension.slice(0, -3);
	if (plans.some(plan => plan.name === stem)) return plans.filter(plan => plan.name === stem);
	const wanted = normalizePlanName(stem);
	return plans.filter(plan => normalizePlanName(plan.name).includes(wanted));
}

/** The first line of the plan's H1, which is the human title the stem was slugified from. */
export async function readPlanHeadingTitle(planPath: string): Promise<string | undefined> {
	try {
		const text = await Bun.file(planPath).text();
		for (const line of text.split("\n")) {
			if (line.startsWith("# ")) return line.slice(2).trim();
		}
	} catch {
		// A missing or unreadable plan is not an error; the stem needles still apply.
	}
	return undefined;
}

/** Choose the plan a transcript is most explicitly about. `plans` lets a bare filename in a
 *  tool path be confirmed against a real file on disk before it wins over weaker pointers. */
export function pickPlanReference(refs: PlanReference[], plans: SavedPlan[]): PlanReference | null {
	if (refs.length === 0) return null;
	const known = new Set(plans.map(plan => normalizePlanName(plan.name)));
	const scored = refs.map(ref => ({ ref, exists: known.has(normalizePlanName(ref.planBaseName)) }));
	scored.sort((a, b) => (a.exists === b.exists ? b.ref.weight - a.ref.weight : a.exists ? 1 : -1));
	return scored[0].ref;
}

/** Transcript files whose encoded session id matches `idPrefix`, searched across every cwd
 *  bucket under `sessionsRoot`. A filename glob rather than a content scan: it resolves an id
 *  without reading a single byte of any transcript. */
export async function findSessionFilesById(sessionsRoot: string, idPrefix: string): Promise<string[]> {
	const lower = idPrefix.toLowerCase();
	const results: string[] = [];
	const patterns = lower.length >= 32 ? [`*/*_${lower}.jsonl`, `*/*_${lower}*.jsonl`] : [`*/*_${lower}*.jsonl`];
	for (const pattern of patterns) {
		try {
			for await (const relative of new Bun.Glob(pattern).scan({ cwd: sessionsRoot, onlyFiles: true })) {
				const file = path.join(sessionsRoot, relative);
				if (!results.includes(file)) results.push(file);
			}
		} catch {
			// An unreadable sessions root is a missing answer, not a failure.
		}
		if (results.length > 0) break;
	}
	return results;
}

/** Every `*.jsonl` directly inside a session bucket. */
export async function listBucketTranscripts(sessionDir: string): Promise<string[]> {
	try {
		const files = await Array.fromAsync(new Bun.Glob("*.jsonl").scan(sessionDir));
		return files.map(relative => path.join(sessionDir, relative));
	} catch {
		return [];
	}
}

/** Every `*.jsonl` in every bucket under the sessions root, as `{dir, file}` pairs so callers
 *  can scan each bucket once instead of once per file. */
export async function listAllTranscripts(sessionsRoot: string): Promise<Array<{ dir: string; file: string }>> {
	try {
		const files = await Array.fromAsync(new Bun.Glob("*/*.jsonl").scan(sessionsRoot));
		return files.map(relative => {
			const file = path.join(sessionsRoot, relative);
			return { dir: path.dirname(file), file };
		});
	} catch {
		return [];
	}
}

/** Parse one transcript and score it against a plan. Returns null when the file is
 *  unreadable, corrupt, or carries no plan signal at all. */
export async function scoreTranscript(file: string, coord: PlanCoordinates): Promise<Candidate | null> {
	let text: string;
	let mtimeMs: number;
	try {
		text = await Bun.file(file).text();
		mtimeMs = (await fs.promises.stat(file)).mtimeMs;
	} catch {
		return null;
	}
	const entries = parseTranscriptFile(text);
	if (!entries) return null;
	const signals = extractSignals(entries, coord);
	if (signals.creates === 0 && signals.revisions === 0 && signals.planFilePaths.length === 0) return null;
	return { file, sessionId: sessionIdFromFile(file), signals, mtimeMs };
}

/** Score every transcript in a directory that the byte prefilter lets through.
 *
 *  The prefilter is what keeps this command usable: a busy project accumulates hundreds of
 *  multi-megabyte transcripts, and parsing all of them to find two candidates costs seconds.
 *
 *  It is sound for the path-based signals, because a transcript that writes a plan path has
 *  the plan's stem somewhere in the same bytes. It is NOT sound for `mode_change`, whose
 *  `planFilePath` is matched case-insensitively — a transcript naming
 *  `local://deploy-the-omnigent-….md` for a file stored as `Deploy-the-Omnigent-….md`
 *  carries the right name in the wrong case and passes the comparison the prefilter rejects.
 *  `skipPrefilter` re-runs the scan without the byte filter, which is the escape hatch for
 *  exactly that divergence. */
export async function scanDirectory(
	dir: string,
	coord: PlanCoordinates,
	options: { extraTitles?: string[]; skipPrefilter?: boolean; exclude?: ReadonlySet<string> } = {},
): Promise<Candidate[]> {
	const files = await listBucketTranscripts(dir);
	const needles = options.skipPrefilter ? [] : planNeedles(coord, options.extraTitles);
	const candidates: Candidate[] = [];
	for (const file of files) {
		if (options.exclude?.has(path.resolve(file))) continue;
		if (needles.length > 0 && !(await fileMentionsAny(file, needles))) continue;
		const candidate = await scoreTranscript(file, coord);
		if (candidate) candidates.push(candidate);
	}
	return candidates;
}

/** Scan a bucket, retrying once without the prefilter when it finds nothing. */
async function scanDirectoryWithFallback(
	dir: string,
	coord: PlanCoordinates,
	options: { extraTitles?: string[]; exclude?: ReadonlySet<string> },
): Promise<{ candidates: Candidate[]; exhaustive: boolean }> {
	const filtered = await scanDirectory(dir, coord, options);
	if (filtered.length > 0) return { candidates: filtered, exhaustive: false };
	const unfiltered = await scanDirectory(dir, coord, { ...options, skipPrefilter: true });
	return { candidates: unfiltered, exhaustive: true };
}

/** Scan the active cwd bucket, then — only if that finds nothing — widen to every other
 *  bucket under the sessions root. The widening pass is what resolves a plan authored from a
 *  different working directory; gating it on an empty fast path keeps the common case cheap.
 *
 *  `exhaustive` reports that a bucket was re-scanned with the prefilter disabled. The caller
 *  surfaces it, because an exhaustive pass means the plan's name was not discoverable and the
 *  negative result for other buckets carries no prefilter guarantee. */
export async function findAuthorCandidates(options: {
	sessionDir: string;
	sessionsRoot: string;
	coord: PlanCoordinates;
	extraTitles?: string[];
	currentFile?: string;
}): Promise<{ candidates: Candidate[]; widened: boolean; exhaustive: boolean }> {
	const exclude = new Set<string>();
	if (options.currentFile) exclude.add(path.resolve(options.currentFile));

	const local = await scanDirectoryWithFallback(options.sessionDir, options.coord, {
		extraTitles: options.extraTitles,
		exclude,
	});
	if (local.candidates.length > 0)
		return { candidates: local.candidates, widened: false, exhaustive: local.exhaustive };

	const localDir = path.resolve(options.sessionDir);
	const byDir = new Map<string, string[]>();
	for (const { dir, file } of await listAllTranscripts(options.sessionsRoot)) {
		if (path.resolve(dir) === localDir) continue;
		const bucket = byDir.get(dir) ?? [];
		bucket.push(file);
		byDir.set(dir, bucket);
	}

	const wider: Candidate[] = [];
	let exhaustive = false;
	for (const [dir] of byDir) {
		const bucket = await scanDirectoryWithFallback(dir, options.coord, {
			extraTitles: options.extraTitles,
			exclude,
		});
		exhaustive ||= bucket.exhaustive;
		wider.push(...bucket.candidates);
	}
	return { candidates: dedupeByFile(wider), widened: true, exhaustive };
}

function dedupeByFile(candidates: Candidate[]): Candidate[] {
	const seen = new Map<string, Candidate>();
	for (const candidate of candidates) seen.set(path.resolve(candidate.file), candidate);
	return [...seen.values()];
}

/** The saved plan a transcript reference names, if one exists on disk. */
export function matchSavedPlan(ref: PlanCoordinates, plans: SavedPlan[]): SavedPlan | undefined {
	const wanted = normalizePlanName(ref.planBaseName);
	return plans.find(plan => normalizePlanName(plan.name) === wanted);
}
