import * as path from "node:path";
import { loadEntriesFromFile } from "@oh-my-pi/pi-coding-agent";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionUISelectOption,
} from "@oh-my-pi/pi-coding-agent";
import type { AutocompleteItem } from "@oh-my-pi/pi-tui";
import { getHistoryDbPath, getSessionsDir } from "@oh-my-pi/pi-utils";
import { Database } from "bun:sqlite";
import {
	type Candidate,
	type SavedPlan,
	findAuthorCandidates,
	findSessionFilesById,
	listSavedPlans,
	matchPlans,
	matchSavedPlan,
	pickPlanReference,
	readPlanHeadingTitle,
} from "./lookup";
import { type AuthorMatch, candidateLabel, displaySessionId, rankCandidates, renderAuthor } from "./report";
import {
	type PlanCoordinates,
	type TranscriptEntry,
	coordinatesFromPath,
	extractPlanReferences,
	extractSignals,
	isSessionIdQuery,
	sessionIdFromFile,
} from "./transcript";

/** Session ids offered as argument completions. */
const SESSION_COMPLETION_LIMIT = 10;

/** Cached because argument completions receive only the typed prefix — no context object, and
 *  `getArgumentCompletions` is typed to return synchronously. Refreshed on every session
 *  transition so a `/resume` or `cd` cannot leave completions pointing at the old bucket. */
let cachedContext: { cwd: string; sessionDir: string; artifactsDir: string | null } | null = null;

type Resolution = {
	coord: PlanCoordinates;
	/** Absolute path when the plan is known on disk; otherwise the transcript's own path form,
	 *  which for a foreign session's `local://` is not resolvable here — hence the fallback. */
	planDisplayPath: string;
	extraTitles: string[];
	implementationSessionId?: string;
};

type QueryOutcome = { kind: "resolved"; resolution: Resolution } | { kind: "planChoices"; plans: SavedPlan[] } | null;

function artifactsDirOf(ctx: ExtensionContext): string | null {
	return ctx.localProtocolOptions?.getArtifactsDir?.() ?? null;
}

/** Everything the completion callback needs, all of which lives on the base context — the
 *  command context adds only session-control methods, so event handlers can prime this too. */
function cacheContext(ctx: ExtensionContext): void {
	cachedContext = { cwd: ctx.cwd, sessionDir: ctx.sessionManager.getSessionDir(), artifactsDir: artifactsDirOf(ctx) };
}

async function readTranscript(file: string): Promise<TranscriptEntry[]> {
	try {
		return (await loadEntriesFromFile(file)) as unknown as TranscriptEntry[];
	} catch {
		return [];
	}
}

/** Resolution for a plan we already know exists on disk. The absolute path is preferred over
 *  a transcript's own path form because it is the one the needle set can be matched against
 *  reliably — a foreign session's `local://` means nothing here. */
function resolutionForPlan(plan: SavedPlan | null): Resolution | null {
	if (!plan) return null;
	const coord = coordinatesFromPath(`${plan.name}.md`);
	if (!coord) return null;
	return {
		coord: { ...coord, planPath: plan.absolutePath },
		planDisplayPath: plan.absolutePath,
		extraTitles: [plan.name],
	};
}

/** The plan a transcript is about, plus extra needle strings worth searching transcripts for:
 *  the saved plan's stem and its human H1, since a transcript may only ever spell the title
 *  the stem was slugified from. */
function resolutionFromEntries(entries: TranscriptEntry[], plans: SavedPlan[]): Resolution | null {
	const ref = pickPlanReference(extractPlanReferences(entries), plans);
	if (!ref) return null;
	const matched = matchSavedPlan(ref, plans);
	return {
		coord: ref,
		planDisplayPath: matched?.absolutePath ?? ref.planPath,
		extraTitles: [ref.stem, matched?.name ?? ""].filter(value => value !== ""),
	};
}

async function resolveQuery(query: string, ctx: ExtensionCommandContext, plans: SavedPlan[]): Promise<QueryOutcome> {
	const trimmed = query.trim();

	if (trimmed === "") {
		const live = ctx.sessionManager.getEntries() as unknown as TranscriptEntry[];
		const resolution = resolutionFromEntries(live, plans);
		return resolution ? { kind: "resolved", resolution } : null;
	}

	if (/^(local|xd):\/\//i.test(trimmed) || path.isAbsolute(trimmed)) {
		const coord = coordinatesFromPath(trimmed);
		if (!coord) return null;
		return { kind: "resolved", resolution: { coord, planDisplayPath: coord.planPath, extraTitles: [coord.stem] } };
	}

	if (isSessionIdQuery(trimmed)) {
		const files = await findSessionFilesById(getSessionsDir(), trimmed);
		const file = files[0];
		if (!file) return null;
		const resolution = resolutionFromEntries(await readTranscript(file), plans);
		if (!resolution) return null;
		return {
			kind: "resolved",
			resolution: { ...resolution, implementationSessionId: sessionIdFromFile(file) || trimmed.toLowerCase() },
		};
	}

	const matches = matchPlans(plans, trimmed);
	if (matches.length === 0) return null;
	if (matches.length > 1) return { kind: "planChoices", plans: matches };
	const resolution = resolutionForPlan(matches[0]);
	return resolution ? { kind: "resolved", resolution } : null;
}

async function pickPlan(plans: SavedPlan[], ctx: ExtensionCommandContext): Promise<SavedPlan | null> {
	if (!ctx.hasUI) return plans[0];
	const options: ExtensionUISelectOption[] = plans.map(plan => ({ label: plan.name, description: plan.location }));
	const chosen = await ctx.ui.select(`${plans.length} plans match — which one?`, options);
	if (!chosen) return null;
	return plans[options.findIndex(option => option.label === chosen)] ?? plans[0];
}

/** Stored session name. Point lookup only — `session_titles` is keyed by session id with no
 *  text index, so this stays cheap against a year-old database. Returns undefined rather than
 *  throwing when the database or table is missing, which is the normal state in a fresh
 *  install and after `omp gc` prunes history. */
function lookupSessionTitle(sessionId: string): string | undefined {
	if (!sessionId) return undefined;
	let db: Database | undefined;
	try {
		db = new Database(getHistoryDbPath(), { readonly: true });
		const row = db.query("SELECT title FROM session_titles WHERE session_id = ?").get(sessionId) as {
			title?: unknown;
		} | null;
		return typeof row?.title === "string" && row.title !== "" ? row.title : undefined;
	} catch {
		return undefined;
	} finally {
		try {
			db?.close();
		} catch {
			// A read-only handle that never opened has nothing to close.
		}
	}
}

async function chooseAuthor(matches: AuthorMatch[], ctx: ExtensionCommandContext): Promise<AuthorMatch | null> {
	if (matches.length <= 1 || !ctx.hasUI) return matches[0] ?? null;
	const options: ExtensionUISelectOption[] = matches.slice(0, 20).map(match => ({
		label: candidateLabel(match, lookupSessionTitle(displaySessionId(match.candidate))),
	}));
	const chosen = await ctx.ui.select(`${matches.length} sessions reference this plan — which authored it?`, options);
	if (!chosen) return null;
	const index = options.findIndex(option => option.label === chosen);
	return index === -1 ? matches[0] : matches[index];
}

async function reportPlanAuthor(rawArgs: string, ctx: ExtensionCommandContext): Promise<void> {
	cacheContext(ctx);
	const plans = listSavedPlans(ctx.cwd, artifactsDirOf(ctx));
	const outcome = await resolveQuery(rawArgs, ctx, plans);
	if (!outcome) {
		ctx.ui.notify("No plan matched. Pass a plan name, a plan path, or a session id.", "warning");
		return;
	}

	const resolution: Resolution | null =
		outcome.kind === "resolved" ? outcome.resolution : resolutionForPlan(await pickPlan(outcome.plans, ctx));
	if (!resolution) return;

	const heading = await readPlanHeadingTitle(resolution.planDisplayPath);
	const extraTitles = [...resolution.extraTitles, heading ?? ""].filter(value => value !== "");

	const { candidates, widened, exhaustive } = await findAuthorCandidates({
		sessionDir: ctx.sessionManager.getSessionDir(),
		sessionsRoot: getSessionsDir(),
		coord: resolution.coord,
		extraTitles,
		currentFile: ctx.sessionManager.getSessionFile(),
	});

	// The live session is excluded from the disk scan because its transcript is still being
	// appended to, but it may legitimately be the author — an author who later approved their
	// own plan lands here. Only a creating write qualifies it; mere discussion does not.
	const liveEntries = ctx.sessionManager.getEntries() as unknown as TranscriptEntry[];
	const selfSignals = extractSignals(liveEntries, resolution.coord);
	if (selfSignals.creates > 0) {
		const self: Candidate = {
			file: ctx.sessionManager.getSessionFile() ?? "(this session)",
			sessionId: ctx.sessionManager.getSessionId(),
			signals: selfSignals,
			mtimeMs: Date.now(),
		};
		candidates.push(self);
	}

	const matches = rankCandidates(candidates, resolution.coord);
	if (matches.length === 0) {
		ctx.ui.notify(`No session authored plan \`${resolution.coord.stem}\`.`, "warning");
		return;
	}

	const chosen = await chooseAuthor(matches, ctx);
	if (!chosen) return;

	const sessionId = displaySessionId(chosen.candidate);
	const body = renderAuthor(chosen, resolution.coord, {
		planDisplayPath: resolution.planDisplayPath,
		title: lookupSessionTitle(sessionId),
		implementationSessionId: resolution.implementationSessionId,
	});

	const scopeNotes: string[] = [];
	if (widened) scopeNotes.push("**Scope:** searched every cwd bucket (no match in this one).");
	if (exhaustive) {
		scopeNotes.push(
			"**Note:** no transcript spelled this plan's name literally, so the search fell back to parsing every session in scope. Rename the plan file to match its title to restore the fast path.",
		);
	}
	const runnersUp = matches
		.slice(1, 4)
		.filter(match => match.candidate.file !== chosen.candidate.file)
		.map(match => `  · ${candidateLabel(match, lookupSessionTitle(displaySessionId(match.candidate)))}`);
	const sections = [
		body,
		...scopeNotes,
		runnersUp.length > 0 ? `**Also referenced:**\n${runnersUp.join("\n")}` : "",
	].filter(value => value !== "");

	ctx.ui.notify(sections.join("\n"), "info");
}

/** Session ids as argument completions. Filenames lead with a sortable timestamp, so sorting
 *  the names orders the sessions newest-first without stat-ing anything. */
function sessionIdCompletions(prefix: string, sessionDir: string): AutocompleteItem[] {
	const wanted = prefix.trim().toLowerCase();
	let files: string[] = [];
	try {
		files = Array.from(new Bun.Glob("*.jsonl").scanSync({ cwd: sessionDir, onlyFiles: true }));
	} catch {
		return [];
	}
	const items: AutocompleteItem[] = [];
	const seen = new Set<string>();
	for (const file of files.sort().reverse()) {
		const base = file.split("/").pop() ?? "";
		const id = sessionIdFromFile(base);
		if (!id || seen.has(id)) continue;
		if (wanted !== "" && !id.startsWith(wanted)) continue;
		seen.add(id);
		items.push({ value: id, label: id, description: base.split("_")[0] ?? "" });
		if (items.length >= SESSION_COMPLETION_LIMIT) break;
	}
	return items;
}

function planCompletions(prefix: string, plans: SavedPlan[]): AutocompleteItem[] {
	const wanted = prefix.trim().toLowerCase();
	const items: AutocompleteItem[] = [];
	for (const plan of plans) {
		if (items.length >= SESSION_COMPLETION_LIMIT) break;
		if (wanted !== "" && !plan.name.toLowerCase().includes(wanted)) continue;
		items.push({ value: plan.name, label: plan.name, description: `${plan.location} plan` });
	}
	return items;
}

export default function (pi: ExtensionAPI) {
	const refresh = (_event: unknown, ctx: ExtensionContext): void => cacheContext(ctx);

	pi.on("session_start", refresh);
	pi.on("session_switch", refresh);

	pi.registerCommand("plan-author", {
		description: "Find the session that authored a plan (by plan name, plan path, or implementing session id)",
		getArgumentCompletions: argumentPrefix => {
			if (!cachedContext) return null;
			const plans = listSavedPlans(cachedContext.cwd, cachedContext.artifactsDir);
			return [
				...sessionIdCompletions(argumentPrefix, cachedContext.sessionDir),
				...planCompletions(argumentPrefix, plans),
			];
		},
		handler: async (args, ctx) => {
			await reportPlanAuthor(args, ctx);
		},
	});
}
