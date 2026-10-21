/** A session transcript entry, narrowed to the fields this extension reads.
 *  Mirrors the shape written to `<bucket>/<fileSafeTimestamp>_<sessionId>.jsonl`. */
export type TranscriptEntry = {
	type?: string;
	data?: Record<string, unknown> | null;
	message?: {
		role?: string;
		content?: unknown;
		details?: unknown;
	};
};

/** Extracted plan coordinates: where the plan is addressed and what it is called. */
export type PlanCoordinates = {
	/** The path form carried by transcripts — `local://…` or absolute. Never resolved. */
	planPath: string;
	planBaseName: string;
	/** `planBaseName` without the `.md` suffix. */
	stem: string;
};

/** One way a transcript points at a plan, with the weight that breaks ties between them. */
export type PlanReference = PlanCoordinates & {
	source: PlanReferenceSource;
	weight: number;
};

/** Where a plan reference came from, strongest evidence first. */
export type PlanReferenceSource = "approval" | "loadedFrom" | "modeChange" | "plansDir" | "localTool";

/** Signals a single transcript carries about one plan. */
export type PlanSignals = {
	/** Writes that CREATE the plan: a `write` at the plan path, or an `xd://propose` naming it. */
	creates: number;
	/** Writes that MODIFY an existing plan. */
	revisions: number;
	/** `mode_change` entries carrying `data.planFilePath`. */
	planFilePaths: string[];
	/** `Plan approved.` markers — an implementer carries these, an author does not. */
	approvals: number;
};

/** The in-progress draft every plan-mode session starts from. It is not a saved plan. */
const DRAFT_STEM = "PLAN";

/** `Plan approved.` prompt markers, ordered most stable first. The approved-plan prompt has
 *  been rewritten several times in this fork, and each rewrite retired the previous anchor:
 *  the `<plan path="…">` attribute is machine-readable and survives inline rewrites, the
 *  `durable copy at` and `Finalized plan artifact` lines come from the same template era, and
 *  the `MUST read … before execution` wording is the pre-inline fallback that still resolves
 *  older transcripts. Missing the last one silently drops roughly a quarter of real
 *  approvals, so keep the list complete rather than trimming it to what is newest. */
const APPROVAL_MARKERS: RegExp[] = [
	/<plan path="(.+?)">/,
	/durable copy at `(.+?)`/,
	/Finalized plan artifact: `(.+?)`/,
	/(?:You )?MUST read `(.+?)` before execut/,
];

const SOURCE_WEIGHTS: Record<PlanReferenceSource, number> = {
	approval: 100,
	loadedFrom: 80,
	modeChange: 60,
	plansDir: 40,
	localTool: 20,
};

const WRITE_TOOLS: Record<string, true> = { write: true };
const EDIT_TOOLS: Record<string, true> = { write: true, edit: true };
const PATH_ARG_KEYS = ["path", "dst", "file_path", "filePath", "localPath"];
const SESSION_ID_PATTERN = /^[0-9a-fA-F-]{36}$/;

/** Extract full text from a message content (handles both string and array content). */
export function getMessageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter(
				(c): c is { type: "text"; text: string } =>
					typeof c === "object" && c !== null && c.type === "text" && typeof c.text === "string",
			)
			.map(c => c.text)
			.join("\n");
	}
	return "";
}

/** Lowercase, collapse every run of non-alphanumerics to a single hyphen, trim. Lets a plan
 *  stem, a working slug, and a prose title all compare equal:
 *  `Deploy-the-Omnigent-server…` → `deploy the omnigent server…` → `deploy-the-omnigent-server…`. */
export function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Drop a `:300-554` / `:12` line range a `read` tool call appends to its target. Without this
 *  a ranged read turns the plan's basename into `Foo.md:300-554`, which then fails to match
 *  every other reference to the same plan and poisons the needle set. */
export function stripLineRange(value: string): string {
	return value.replace(/:\d+(?:-\d+)?$/, "");
}

/** Strip a trailing `.md` and slugify, so `A B.md`, `a-b.md`, and `A_B` all agree. */
export function normalizePlanName(value: string): string {
	return slugify(value.replace(/\.md$/i, ""));
}

/** Split a transcript path form into raw path + basename, or null when unusable. */
export function coordinatesFromPath(planPath: string): PlanCoordinates | null {
	const trimmed = stripLineRange(planPath.trim());
	if (!trimmed) return null;
	const planBaseName = trimmed.split("/").pop() ?? "";
	if (!planBaseName || planBaseName === `${DRAFT_STEM}.md`) return null;
	return { planPath: trimmed, planBaseName, stem: planBaseName.replace(/\.md$/i, "") };
}

/** Build coordinates from an already-separated basename. */
export function coordinatesFromBaseName(planBaseName: string, planPath?: string): PlanCoordinates | null {
	const direct = coordinatesFromPath(planBaseName);
	if (!direct) return null;
	if (!planPath) return direct;
	return { planPath, planBaseName: direct.planBaseName, stem: direct.stem };
}

/** True when two path forms address the same plan, comparing on the final component. */
export function samePlan(a: PlanCoordinates, b: PlanCoordinates): boolean {
	return normalizePlanName(a.planBaseName) === normalizePlanName(b.planBaseName);
}

function pathArg(args: unknown): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const record = args as Record<string, unknown>;
	for (const key of PATH_ARG_KEYS) {
		const value = record[key];
		if (typeof value === "string" && value !== "") return value;
	}
	return undefined;
}

function isUnderPlansDir(target: string): boolean {
	const withoutScheme = target.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
	return /(^|\/)plans\//.test(withoutScheme) || /(^|\/)plans$/.test(withoutScheme);
}

/** Recover the plan path from an approval prompt, or null when the text is not one. */
export function extractApprovedPlanPath(text: string): string | null {
	if (!text.includes("Plan approved.")) return null;
	for (const marker of APPROVAL_MARKERS) {
		const match = marker.exec(text);
		if (match?.[1]) return match[1];
	}
	return null;
}

/** First two lines of an `xd://propose` write: `<slug>` then `<title>`. The host renames the
 *  saved plan after the title, but an in-flight draft keeps its working slug on line 1 — so
 *  authorship has to accept EITHER line, not just the first. */
export function proposeNames(content: string): string[] {
	return content
		.split("\n", 2)
		.map(line => line.trim())
		.filter(line => line !== "");
}

/** True when a proposed name identifies this plan, tolerating the working-slug rename. */
export function proposeMatchesPlan(content: string, coord: PlanCoordinates): boolean {
	const wanted = normalizePlanName(coord.stem);
	if (!wanted) return false;
	return proposeNames(content).some(name => normalizePlanName(name) === wanted);
}

/** Signals computed from one entry list against one plan. */
export function extractSignals(entries: TranscriptEntry[], coord: PlanCoordinates): PlanSignals {
	const signals: PlanSignals = { creates: 0, revisions: 0, planFilePaths: [], approvals: 0 };
	const wantedPath = normalizePlanName(coord.planPath);
	const wantedBase = normalizePlanName(coord.planBaseName);
	/** True when a path form addresses THIS plan. Every non-write signal passes through here:
	 *  an approval for some other plan, or a `mode_change` carrying the `PLAN.md` draft, says
	 *  nothing about authorship here — and letting them accumulate turns every session that
	 *  ever entered plan mode into a candidate. */
	const targetsPlan = (target: string | undefined): boolean => {
		if (!target) return false;
		const stripped = stripLineRange(target);
		const base = stripLineRange(stripped.split("/").pop() ?? "");
		return normalizePlanName(stripped) === wantedPath || normalizePlanName(base) === wantedBase;
	};

	for (const entry of entries) {
		if (entry.type === "mode_change" && entry.data) {
			const planFile = entry.data.planFilePath;
			if (typeof planFile === "string" && planFile.length > 0 && targetsPlan(planFile)) {
				signals.planFilePaths.push(planFile);
			}
		}

		const msg = entry.message;
		if (!msg) continue;

		if (msg.role === "user" || msg.role === "developer") {
			const approved = extractApprovedPlanPath(getMessageText(msg.content));
			if (approved !== null && targetsPlan(approved)) signals.approvals += 1;
		}

		if (!Array.isArray(msg.content)) continue;
		for (const block of msg.content) {
			if (typeof block !== "object" || block === null) continue;
			const call = block as { type?: string; name?: unknown; arguments?: unknown };
			if (call.type !== "toolCall") continue;
			const name = call.name;
			if (typeof name !== "string") continue;
			const args = call.arguments;
			const target = pathArg(args);

			if (name === "write" && typeof target === "string" && target.startsWith("xd://propose")) {
				const content =
					typeof args === "object" && args !== null ? (args as Record<string, unknown>).content : undefined;
				if (typeof content === "string" && proposeMatchesPlan(content, coord)) signals.creates += 1;
				continue;
			}

			if (!(name in EDIT_TOOLS) || !targetsPlan(target)) continue;
			if (name in WRITE_TOOLS) signals.creates += 1;
			else signals.revisions += 1;
		}
	}

	return signals;
}

/** Every plan this transcript points at, strongest evidence first. A session that reads,
 *  edits, and later loads a different plan yields all three, ordered by how explicit each
 *  pointer is — the caller decides whether that is an ambiguity or a history. */
export function extractPlanReferences(entries: TranscriptEntry[]): PlanReference[] {
	const found = new Map<string, PlanReference>();
	const record = (planPath: string, source: PlanReferenceSource): void => {
		const coord = coordinatesFromPath(planPath);
		if (!coord) return;
		const key = normalizePlanName(coord.planBaseName);
		const weight = SOURCE_WEIGHTS[source];
		const existing = found.get(key);
		if (existing && existing.weight >= weight) return;
		found.set(key, { ...coord, source, weight });
	};

	for (const entry of entries) {
		if (entry.type === "mode_change" && entry.data) {
			record(asString(entry.data.planFilePath) ?? "", "modeChange");
			const loadedFrom = entry.data.loadedFrom;
			if (typeof loadedFrom === "object" && loadedFrom !== null) {
				const absolutePath = asString((loadedFrom as Record<string, unknown>).absolutePath);
				if (absolutePath) record(absolutePath, "loadedFrom");
				else record(asString((loadedFrom as Record<string, unknown>).url) ?? "", "loadedFrom");
			}
		}

		const msg = entry.message;
		if (!msg) continue;

		if (msg.role === "user" || msg.role === "developer") {
			const approved = extractApprovedPlanPath(getMessageText(msg.content));
			if (approved) record(approved, "approval");
		}

		if (!Array.isArray(msg.content)) continue;
		for (const block of msg.content) {
			if (typeof block !== "object" || block === null) continue;
			const call = block as { type?: string; arguments?: unknown };
			if (call.type !== "toolCall") continue;
			const target = pathArg(call.arguments);
			if (!target) continue;
			if (isUnderPlansDir(target)) record(target, "plansDir");
			else if (/^(local|xd):\/\/.+\.md$/i.test(target)) record(target, "localTool");
		}
	}

	return [...found.values()].sort((a, b) => b.weight - a.weight);
}

/** True when a query should be treated as a session id rather than a plan name.
 *
 *  Eight hex digits is the floor, and UUID hyphens are tolerated: users paste whole UUIDs
 *  out of `/resume` far more often than a bare leading group, and a query containing hyphens
 *  is otherwise indistinguishable from a filename. A plan stem made entirely of hex digits
 *  is the only collision, and it would need eight or more of them to reach this branch. */
export function isSessionIdQuery(query: string): boolean {
	return /^[0-9a-f]{8,}$/i.test(query.replaceAll("-", ""));
}

/** Session id encoded in a `<fileSafeTimestamp>_<sessionId>.jsonl` filename, if present. */
export function sessionIdFromFile(file: string): string {
	const base = file.split("/").pop() ?? "";
	const stem = base.endsWith(".jsonl") ? base.slice(0, -".jsonl".length) : base;
	const underscore = stem.indexOf("_");
	const id = underscore === -1 ? stem : stem.slice(underscore + 1);
	return SESSION_ID_PATTERN.test(id) ? id : "";
}

/** Parse a raw transcript file. Returns null for anything unreadable or corrupt — a partial
 *  tail must never produce a false author attribution. */
export function parseTranscriptFile(text: string): TranscriptEntry[] | null {
	const entries: TranscriptEntry[] = [];
	let sawHeader = false;
	for (const line of text.split("\n")) {
		if (line.length === 0) continue;
		let entry: TranscriptEntry;
		try {
			entry = JSON.parse(line) as TranscriptEntry;
		} catch {
			return null;
		}
		if (!entry || typeof entry !== "object") return null;
		if (entry.type === "session") sawHeader = true;
		entries.push(entry);
	}
	return sawHeader ? entries : null;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}
