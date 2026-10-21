import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	type Candidate,
	fileMentionsAny,
	findAuthorCandidates,
	findSessionFilesById,
	listSavedPlans,
	matchPlans,
	planNeedles,
	scoreTranscript,
} from "./lookup";
import { rankCandidates } from "./report";
import {
	type PlanCoordinates,
	type TranscriptEntry,
	coordinatesFromPath,
	extractApprovedPlanPath,
	extractPlanReferences,
	extractSignals,
	isSessionIdQuery,
} from "./transcript";

const OMNIGENT = coordinatesFromPath(
	"local://Deploy-the-Omnigent-server-to-the-Whiteblossom-cluster.md",
) as PlanCoordinates;

let tmp: string;

beforeEach(async () => {
	// Scratch lives under the repo's gitignored `.wt/`, not the shared /tmp — a busy or
	// quota-limited tmpfs makes fixture writes fail with EDQUOT for reasons unrelated to
	// the code under test.
	const root = path.join(import.meta.dir, "..", "..", "..", ".wt", "plan-author-test");
	await fs.mkdir(root, { recursive: true });
	tmp = await fs.mkdtemp(path.join(root, "case-"));
});

afterEach(async () => {
	await fs.rm(tmp, { recursive: true, force: true });
});

/** Build a transcript with a `session` header so parsing accepts it, then raw JSONL lines. */
function transcript(...entries: unknown[]): string {
	return [{ type: "session", id: "s" }, ...entries].map(entry => JSON.stringify(entry)).join("\n");
}

function writeSession(name: string, body: string): Promise<string> {
	const file = path.join(tmp, name);
	return Bun.write(file, body).then(() => file);
}

/** A `write` tool call as the runtime records it inside an assistant message. */
function toolCall(name: string, args: Record<string, unknown>): TranscriptEntry {
	return { type: "message", message: { role: "assistant", content: [{ type: "toolCall", name, arguments: args }] } };
}

function candidate(file: string, creates: number, revisions: number, overrides: Partial<Candidate> = {}): Candidate {
	return {
		file,
		sessionId: path.basename(file).split("_").pop() ?? "",
		signals: { creates, revisions, planFilePaths: [], approvals: 0 },
		mtimeMs: 0,
		...overrides,
	};
}

describe("propose authorship", () => {
	test("a propose write whose line 1 is a working slug, not the plan stem, still counts as creating the plan", () => {
		// The author proposed under a draft slug ("omnigent-cluster-onboarding-plan") while the
		// host named the saved file after the title. Matching only line 1 drops the real author.
		const entries = [
			toolCall("write", {
				path: "xd://propose",
				content:
					"omnigent-cluster-onboarding-plan\nDeploy the Omnigent server to the Whiteblossom cluster\n\n# Deploy…",
			}),
		];
		expect(extractSignals(entries, OMNIGENT).creates).toBe(1);
	});

	test("a propose write naming a different plan does not count", () => {
		const entries = [
			toolCall("write", { path: "xd://propose", content: "some-other-plan\nSome other plan\n\nbody" }),
		];
		expect(extractSignals(entries, OMNIGENT).creates).toBe(0);
	});

	test("creating write beats many revisions regardless of which session was noisier", () => {
		// The real failure: session 01a148ad touched the plan 19 times after the author was
		// long gone, and a "most plan writes wins" ranking handed it the credit.
		const matches = rankCandidates(
			[candidate("/s/reviser.jsonl", 0, 19), candidate("/s/author.jsonl", 1, 0)],
			OMNIGENT,
		);
		expect(matches[0].candidate.file).toBe("/s/author.jsonl");
		expect(matches[0].created).toBe(true);
		expect(matches[0].candidate.signals.revisions).toBe(0);
	});

	test("among creators, the one with more creating writes wins", () => {
		const matches = rankCandidates([candidate("/s/one.jsonl", 1, 5), candidate("/s/two.jsonl", 3, 0)], OMNIGENT);
		expect(matches[0].candidate.file).toBe("/s/two.jsonl");
	});

	test("only an approval for THIS plan marks a session as an implementer", () => {
		// Counting every approval in the session made all 24 plan-mode sessions in this user's
		// transcripts look like candidates for a plan most of them never touched.
		const approval = (plan: string): TranscriptEntry => ({
			type: "message",
			message: { role: "user", content: `Plan approved.\nFinalized plan artifact: \`${plan}\`` },
		});
		expect(extractSignals([approval(OMNIGENT.planPath)], OMNIGENT).approvals).toBe(1);
		expect(extractSignals([approval("local://some-other-plan.md")], OMNIGENT).approvals).toBe(0);
	});

	test("a mode_change for an unrelated draft is not a signal for this plan", () => {
		// Every plan-mode session carries a `PLAN.md` draft entry; without filtering, each one
		// becomes a candidate and swamps the real author.
		const entries: TranscriptEntry[] = [{ type: "mode_change", data: { planFilePath: "local://PLAN.md" } }];
		expect(extractSignals(entries, OMNIGENT)).toEqual({ creates: 0, revisions: 0, planFilePaths: [], approvals: 0 });
	});

	test("a line-ranged read of the plan still identifies the plan", () => {
		// `read` calls carry `path: <file>.md:300-554`. Swallowing the range into the basename
		// makes the plan unmatchable against every other reference to it.
		const coord = coordinatesFromPath(`${OMNIGENT.planPath}:300-554`) as PlanCoordinates;
		expect(coord.stem).toBe("Deploy-the-Omnigent-server-to-the-Whiteblossom-cluster");
		expect(extractSignals([toolCall("edit", { path: `${OMNIGENT.planPath}:300-554` })], coord).revisions).toBe(1);
	});
});

describe("approval markers", () => {
	const expected = "local://fix-registry-dns-ansible-provisioning.md";

	test.each([
		["plan path attribute", `Plan approved.\n<plan path="${expected}">\n## Plan`],
		["durable copy prose", `Plan approved.\n\ndurable copy at \`${expected}\``],
		[
			"finalized artifact prose",
			`<critical>\nPlan approved. You MUST execute it now.\n</critical>\n\nFinalized plan artifact: \`${expected}\``,
		],
		["pre-inline must-read", `Plan approved.\nYou MUST read \`${expected}\` before executing.`],
	])("%s resolves to the plan path", (_label, text) => {
		// `Finalized plan artifact:` was missing from the marker list and silently dropped 29 of
		// the 124 real approvals in this user's own transcripts.
		expect(extractApprovedPlanPath(text)).toBe(expected);
	});

	test("a message that merely mentions a plan file is not an approval", () => {
		expect(extractApprovedPlanPath(`I read \`${expected}\` earlier.`)).toBeNull();
	});
});

describe("transcript integrity", () => {
	test("a truncated final line yields no candidate rather than a wrong one", async () => {
		const body = `${transcript(toolCall("write", { path: OMNIGENT.planPath, content: "x" }))}\n{"type":"mess`;
		const file = await writeSession("2026-10-17T00-00-00-000Z_aaaaaaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee.jsonl", body);
		expect(await scoreTranscript(file, OMNIGENT)).toBeNull();
	});

	test("a transcript without a session header is rejected", async () => {
		const file = await writeSession(
			"2026-10-17T00-00-00-000Z_bbbbbbbb-cccc-7ddd-8eee-ffffffffffff.jsonl",
			JSON.stringify(toolCall("write", { path: OMNIGENT.planPath, content: "x" })),
		);
		expect(await scoreTranscript(file, OMNIGENT)).toBeNull();
	});

	test("a well-formed creating transcript scores as an author candidate", async () => {
		const file = await writeSession(
			"2026-10-13T08-33-46-180Z_cccccccc-dddd-7eee-8fff-aaaaaaaaaaaa.jsonl",
			transcript(toolCall("write", { path: OMNIGENT.planPath, content: "# Deploy…" })),
		);
		const scored = await scoreTranscript(file, OMNIGENT);
		expect(scored?.sessionId).toBe("cccccccc-dddd-7eee-8fff-aaaaaaaaaaaa");
		expect(scored?.signals.creates).toBe(1);
	});
});

describe("plan reference strength", () => {
	test("an approval outranks a plan load, which outranks a bare tool path", () => {
		// Drives which plan is picked when a session touched several: the most explicit
		// pointer wins rather than whichever appeared last in the file.
		const entries: TranscriptEntry[] = [
			toolCall("edit", { path: "/w/.omp/plans/deploy-the-omnigent-server.md" }),
			{
				type: "mode_change",
				data: { planFilePath: OMNIGENT.planPath, loadedFrom: { absolutePath: "/w/.omp/plans/x.md" } },
			},
			{
				type: "message",
				message: {
					role: "user",
					content:
						"Plan approved. Finalized plan artifact: `local://Deploy-the-Omnigent-server-to-the-Whiteblossom-cluster.md`",
				},
			},
		];
		expect(extractPlanReferences(entries)[0].source).toBe("approval");
	});

	test("the in-progress PLAN.md draft is never treated as a saved plan", () => {
		const entries: TranscriptEntry[] = [{ type: "mode_change", data: { planFilePath: "local://PLAN.md" } }];
		expect(extractPlanReferences(entries)).toEqual([]);
	});

	test("a /plan load resolves through loadedFrom rather than the local draft copy", () => {
		const entries: TranscriptEntry[] = [
			{
				type: "mode_change",
				data: {
					planFilePath: "local://forklift-bootstrap.md",
					loadedFrom: { absolutePath: "/w/.omp/plans/forklift-bootstrap.md" },
				},
			},
		];
		expect(extractPlanReferences(entries).map(ref => ref.source)).toEqual(["loadedFrom"]);
	});
});

describe("stub matching", () => {
	const plans = [
		{
			name: "Deploy-the-Omnigent-server-to-the-Whiteblossom-cluster",
			absolutePath: "/w/.omp/plans/a.md",
			url: "/w/.omp/plans/a.md",
			location: "project" as const,
			mtimeMs: 3,
		},
		{
			name: "Deploy-the-Omnigent-broker",
			absolutePath: "/w/.omp/plans/b.md",
			url: "/w/.omp/plans/b.md",
			location: "project" as const,
			mtimeMs: 2,
		},
		{
			name: "Backstage-OIDC-consent",
			absolutePath: "/w/.omp/plans/c.md",
			url: "/w/.omp/plans/c.md",
			location: "project" as const,
			mtimeMs: 1,
		},
	];

	test("an exact stem wins over a broader substring match", () => {
		expect(matchPlans(plans, "omnigent-broker")).toHaveLength(1);
	});

	test("a partial stub returns every match so the caller can offer a choice", () => {
		expect(matchPlans(plans, "omnigent").map(plan => plan.name)).toEqual([
			"Deploy-the-Omnigent-server-to-the-Whiteblossom-cluster",
			"Deploy-the-Omnigent-broker",
		]);
	});

	test("a stub matching nothing yields no candidates", () => {
		expect(matchPlans(plans, "kubernetes")).toEqual([]);
	});
});

describe("byte prefilter", () => {
	test("a transcript spelling the plan name in its original mixed case is not discarded", async () => {
		// The prefilter once lowercased its needles while the bytes kept their capitals, which
		// rejected the real author — the host writes `Deploy-the-Omnigent-…`, not all-lowercase.
		const body = transcript(
			toolCall("write", { path: "local://Deploy-the-Omnigent-server-to-the-Whiteblossom-cluster.md", content: "x" }),
		);
		const file = await writeSession("2026-10-13T00-00-00-000Z_11111111-1111-7111-8111-111111111111.jsonl", body);
		expect(await fileMentionsAny(file, planNeedles(OMNIGENT))).toBe(true);
	});

	test("a transcript naming only the prose title, never the slug, is not discarded", async () => {
		// The stem is a slug of the title, so a transcript may only ever spell the spaced form.
		const body = transcript(
			toolCall("write", {
				path: "local://some-plan.md",
				content: "Deploy the Omnigent server to the Whiteblossom cluster",
			}),
		);
		const file = await writeSession("2026-10-13T00-00-00-000Z_44444444-4444-7444-8444-444444444444.jsonl", body);
		expect(
			await fileMentionsAny(file, planNeedles(OMNIGENT, ["Deploy the Omnigent server to the Whiteblossom cluster"])),
		).toBe(true);
	});

	test("a needle spanning a chunk boundary is still found", async () => {
		// The prefilter streams in 1 MB chunks; without the carry-over a match straddling a
		// boundary would be lost and the real author silently dropped.
		const needle = "Deploy-the-Omnigent-server-to-the-Whiteblossom-cluster";
		const padding = "x".repeat(1024 * 1024 - Math.floor(needle.length / 2));
		const file = await writeSession(
			"2026-10-13T00-00-00-000Z_22222222-2222-7222-8222-222222222222.jsonl",
			padding + needle + padding,
		);
		expect(await fileMentionsAny(file, planNeedles(OMNIGENT))).toBe(true);
	});

	test("an unrelated transcript is rejected without being parsed", async () => {
		const file = await writeSession(
			"2026-10-13T00-00-00-000Z_33333333-3333-7333-8333-333333333333.jsonl",
			transcript(toolCall("write", { path: "/w/some/other/file.md", content: "nothing to do with omnigent" })),
		);
		expect(await fileMentionsAny(file, planNeedles(OMNIGENT))).toBe(false);
	});
});

describe("saved plan listing", () => {
	test("project plans are listed newest-first and the in-progress draft is excluded", async () => {
		const plansDir = path.join(tmp, "work", ".omp", "plans");
		await fs.mkdir(plansDir, { recursive: true });
		await Bun.write(path.join(plansDir, "old-plan.md"), "a");
		await Bun.write(path.join(plansDir, "new-plan.md"), "b");
		await Bun.write(path.join(plansDir, "PLAN.md"), "draft");

		const plans = listSavedPlans(path.join(tmp, "work"), null);
		expect(plans.map(plan => plan.name).sort()).toEqual(["new-plan", "old-plan"]);
	});

	test("a missing plans directory yields an empty list instead of throwing", () => {
		expect(listSavedPlans(path.join(tmp, "does-not-exist"), null)).toEqual([]);
	});
});

describe("prefilter fallback", () => {
	async function seedBucket(root: string, entries: TranscriptEntry[], name: string): Promise<string> {
		const bucket = path.join(root, "-Work");
		await fs.mkdir(bucket, { recursive: true });
		const file = path.join(bucket, `2026-10-13T00-00-00-000Z_${name}.jsonl`);
		await Bun.write(file, transcript(...entries));
		return bucket;
	}

	test("an author whose transcript spells the plan path in a different case is still found", async () => {
		// The byte prefilter is case-sensitive while path matching is not, so a hand-typed
		// lowercased path is invisible to it. Without the fallback this author vanishes.
		const root = path.join(tmp, "sessions");
		const bucket = await seedBucket(
			root,
			[
				toolCall("write", {
					path: "local://deploy-the-omnigent-server-to-the-whiteblossom-cluster.md",
					content: "# x",
				}),
			],
			"55555555-5555-7555-8555-555555555555",
		);

		const result = await findAuthorCandidates({ sessionDir: bucket, sessionsRoot: root, coord: OMNIGENT });
		expect(result.exhaustive).toBe(true);
		expect(result.candidates.map(candidate => candidate.sessionId)).toContain("55555555-5555-7555-8555-555555555555");
	});

	test("the fast path does not pay for a fallback when the prefilter already matched", async () => {
		const root = path.join(tmp, "sessions");
		const bucket = await seedBucket(
			root,
			[toolCall("write", { path: OMNIGENT.planPath, content: "# x" })],
			"66666666-6666-7666-8666-666666666666",
		);

		const result = await findAuthorCandidates({ sessionDir: bucket, sessionsRoot: root, coord: OMNIGENT });
		expect(result.exhaustive).toBe(false);
		expect(result.widened).toBe(false);
		expect(result.candidates.map(candidate => candidate.sessionId)).toEqual(["66666666-6666-7666-8666-666666666666"]);
	});

	test("an unrelated bucket is not scanned once the active bucket answers", async () => {
		const root = path.join(tmp, "sessions");
		const bucket = await seedBucket(
			root,
			[toolCall("write", { path: OMNIGENT.planPath, content: "# x" })],
			"77777777-7777-7777-8777-777777777777",
		);
		await fs.mkdir(path.join(root, "--elsewhere--"), { recursive: true });
		await Bun.write(
			path.join(root, "--elsewhere--", "2026-10-14T00-00-00-000Z_88888888-8888-7888-8888-888888888888.jsonl"),
			transcript(toolCall("write", { path: OMNIGENT.planPath, content: "# x" })),
		);

		const result = await findAuthorCandidates({ sessionDir: bucket, sessionsRoot: root, coord: OMNIGENT });
		expect(result.widened).toBe(false);
		expect(result.candidates).toHaveLength(1);
	});
});

describe("session id resolution", () => {
	test("a full hyphenated UUID is routed as a session id, not read as a plan name", () => {
		// Users paste whole UUIDs out of `/resume`. A detector that only accepted contiguous hex
		// silently sent them to plan-name matching, where they match nothing.
		expect(isSessionIdQuery("01a148ad-3312-7000-8ad5-a9b1fe69b8ef")).toBe(true);
		expect(isSessionIdQuery("01a148ad")).toBe(true);
		expect(isSessionIdQuery("01A148AD")).toBe(true);
	});

	test("a plan name is not mistaken for a session id", () => {
		expect(isSessionIdQuery("Deploy-the-Omnigent-server-to-the-Whiteblossom-cluster")).toBe(false);
		expect(isSessionIdQuery("deadbeef-not-a-uuid")).toBe(false);
		expect(isSessionIdQuery("1234567")).toBe(false);
	});

	test("a full id resolves to its transcript without reading any transcript content", async () => {
		const root = path.join(tmp, "sessions");
		const bucket = path.join(root, "-Work");
		await fs.mkdir(bucket, { recursive: true });
		const file = path.join(bucket, "2026-10-13T08-33-46-180Z_01a13465-72c4-7000-9725-c7a9e4e546cc.jsonl");
		await Bun.write(file, transcript());

		const found = await findSessionFilesById(root, "01a13465-72c4-7000-9725-c7a9e4e546cc");
		expect(found).toEqual([file]);
	});

	test("an id prefix resolves across every cwd bucket", async () => {
		const root = path.join(tmp, "sessions");
		await fs.mkdir(path.join(root, "-Work"), { recursive: true });
		await fs.mkdir(path.join(root, "--other--"), { recursive: true });
		await Bun.write(
			path.join(root, "--other--", "2026-10-13T00-00-00-000Z_aaaaaaaa-1111-7111-8111-111111111111.jsonl"),
			transcript(),
		);

		expect(await findSessionFilesById(root, "aaaaaaaa")).toHaveLength(1);
	});

	test("an unknown id resolves to nothing rather than an unrelated session", async () => {
		const root = path.join(tmp, "sessions");
		await fs.mkdir(path.join(root, "-Work"), { recursive: true });
		await Bun.write(
			path.join(root, "-Work", "2026-10-13T00-00-00-000Z_aaaaaaaa-1111-7111-8111-111111111111.jsonl"),
			transcript(),
		);

		expect(await findSessionFilesById(root, "ffffffff")).toEqual([]);
	});
});
