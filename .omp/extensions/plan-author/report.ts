import type { Candidate } from "./lookup";
import { normalizePlanName, stripLineRange, type PlanCoordinates } from "./transcript";

/** The ranked result the command reports. */
export type AuthorMatch = {
	candidate: Candidate;
	/** True when this session is the one that CREATED the plan, not merely revised it. */
	created: boolean;
	/** True when this session also carries a `Plan approved.` marker — it both authored and
	 *  implemented the plan, which happens when an author approves their own plan. */
	alsoImplemented: boolean;
};

/** Order candidates best-first.
 *
 *  Creation outranks revision unconditionally. A later session that revised a plan twenty
 *  times is a much louder neighbour than the session that wrote it, so any ranking led by
 *  "most plan-touching writes" hands authorship to the wrong session the moment the plan is
 *  revised. Approval count is the next discriminator because it points the opposite way: a
 *  session holding an approval marker is executing somebody else's plan. Write volume and
 *  mtime only break ties among sessions that already agree about authorship. */
export function rankCandidates(candidates: Candidate[], coord: PlanCoordinates): AuthorMatch[] {
	const wantedBase = normalizePlanName(coord.planBaseName);
	const wantedPath = normalizePlanName(coord.planPath);

	const ranked = candidates
		.filter(
			candidate =>
				candidate.signals.creates > 0 ||
				candidate.signals.revisions > 0 ||
				candidate.signals.planFilePaths.length > 0,
		)
		.map(candidate => {
			const exactPath = candidate.signals.planFilePaths.some(
				planFile => normalizePlanName(stripLineRange(planFile)) === wantedPath,
			);
			const basePath = candidate.signals.planFilePaths.some(
				planFile =>
					normalizePlanName(stripLineRange(stripLineRange(planFile.split("/").pop() ?? ""))) === wantedBase,
			);
			return {
				candidate,
				created: candidate.signals.creates > 0,
				alsoImplemented: candidate.signals.approvals > 0,
				score: [
					-candidate.signals.creates,
					candidate.signals.approvals,
					-candidate.signals.revisions,
					exactPath ? 0 : basePath ? 1 : 2,
					-candidate.mtimeMs,
				],
			};
		});

	ranked.sort((a, b) => {
		for (let i = 0; i < a.score.length; i++) {
			if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
		}
		return 0;
	});

	return ranked.map(entry => ({
		candidate: entry.candidate,
		created: entry.created,
		alsoImplemented: entry.alsoImplemented,
	}));
}

/** Session id encoded in a transcript filename, or a placeholder when it carries none. */
export function displaySessionId(candidate: Candidate): string {
	return candidate.sessionId || "(unknown id)";
}

/** Human-readable start timestamp from a session filename: `2026-10-02T12-44-21-541Z`. */
export function sessionTimestamp(file: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/.exec(file.split("/").pop() ?? "");
	if (!match) return "unknown";
	return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}

/** Short label for a picker entry: what the plan is, when it was touched, and by how much. */
export function candidateLabel(match: AuthorMatch, title?: string): string {
	const { signals } = match.candidate;
	const parts = [`${displaySessionId(match.candidate)} · ${sessionTimestamp(match.candidate.file)}`];
	if (match.created) parts.push(`created (${signals.creates}×)`);
	if (signals.revisions > 0) parts.push(`${signals.revisions} revision${signals.revisions === 1 ? "" : "s"}`);
	if (match.alsoImplemented) parts.push("also implements it");
	if (title) parts.push(title);
	return parts.join(" · ");
}

/** The notification body. `title` is the session's stored name, which is labelled as
 *  possibly stale because it is only rewritten when the user renames the session — a session
 *  that did real work for days can still carry the title from its first prompt. */
export function renderAuthor(
	match: AuthorMatch,
	coord: PlanCoordinates,
	options: { planDisplayPath: string; title?: string; implementationSessionId?: string },
): string {
	const { candidate } = match;
	const lines = [
		`Plan \`${coord.stem}\` authored in session ${displaySessionId(candidate)} (${sessionTimestamp(candidate.file)})`,
		`**Session:** ${candidate.file}`,
		`**Session ID:** ${displaySessionId(candidate)}`,
		`**Plan:** ${options.planDisplayPath}`,
	];
	if (options.implementationSessionId) {
		lines.push(`**Implementation session:** ${options.implementationSessionId}`);
	}
	lines.push(
		match.created
			? `**Role:** author (${candidate.signals.creates} creating write${candidate.signals.creates === 1 ? "" : "s"})`
			: `**Role:** most recent reviser (no creating write found; ${candidate.signals.revisions} revision${candidate.signals.revisions === 1 ? "" : "s"})`,
	);
	if (match.alsoImplemented)
		lines.push("**Note:** this session also carries a plan approval — it authored and executed the plan.");
	if (options.title) lines.push(`**Session title (may be stale):** ${options.title}`);
	return lines.join("\n");
}
