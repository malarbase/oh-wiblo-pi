#!/usr/bin/env bun
/**
 * organize.ts — Rebuild owp fork history into topical commits via tree reconstruction.
 *
 * Instead of replaying ~78 interleaved fork commits (rebase → conflicts → lost
 * files), this tool branches from upstream/main and re-applies the FINAL TREE
 * STATE of every registered fork feature as one commit per feature. No patch
 * replay means zero conflicts by construction. Deletions are adjudicated first:
 * intentional ones come from § removals in feature-registry.yaml, everything
 * else is restored from upstream/main.
 *
 * Usage:
 *   bun .omp/skills/reorganize-history/organize.ts                          # triage report (read-only, exit 0)
 *   bun .omp/skills/reorganize-history/organize.ts --rebuild                # rebuild + swap main
 *   bun .omp/skills/reorganize-history/organize.ts --rebuild --stay-on-wip  # stop before swapping main (testing)
 *
 * State/log reuse ~/.omp/sync-state.json and ~/.omp/sync-log.jsonl so the
 * existing `sync.ts --revert` and interrupted-sync warning work for reorgs too.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $ } from "bun";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Feature {
	name: string;
	description?: string;
	owned_paths: string[];
}

interface Divergence {
	path: string;
	reason: string;
	resolution: string;
}

interface Removal {
	path: string;
	reason: string;
}

interface Registry {
	features: Feature[];
	divergences?: Divergence[];
	removals?: Removal[];
}

interface SyncState {
	repoPath: string;
	preSyncHead: string;
	preSyncHeadShort: string;
	upstreamHead: string;
	upstreamBase: string;
	startedAt: string;
	status: "started" | "rebase_ok" | "typecheck_ok" | "completed" | "failed_rebase" | "failed_typecheck" | "failed_verify" | "reverted";
	syncId: string;
	observations?: string[];
}

interface LogEntry extends SyncState {
	finishedAt?: string;
	reason?: string;
}

interface DeltaRow {
	status: string;
	file: string;
}

	interface Classification {
		converged: string[];
		registered: string[];
		accidentalCandidates: { file: string; commit: string }[];
		forkOwned: Map<string, Set<string>>;
		overlayFiles: Set<string>;
		divergenceCovered: Set<string>;
		/** prefer_ours divergence files — kept identical to old main, so a missing diff row is OK */
		divergencePreferOurs: Set<string>;
		autoRestored: Set<string>;
		unregistered: { file: string; status: string }[];
	}

// ─── Constants / CLI ────────────────────────────────────────────────────────

const root = path.resolve(import.meta.dir, "../../..");
const registryPath = path.resolve(import.meta.dir, "../sync-upstream/feature-registry.yaml");
/** Synthetic forkOwned bucket for prefer_ours divergences with no feature owner. */
const DIVERGENCE_OURS_BUCKET = "__divergence-prefer-ours";

function hasConflictMarkers(bytes: Buffer): boolean {
	return /^<{7} |^={7}$|^>{7} /m.test(bytes.toString("latin1"));
}
// Same state/log files as sync.ts so its --revert keeps working for reorgs.
const STATE_PATH = path.join(os.homedir(), ".omp", "sync-state.json");
const LOG_PATH = path.join(os.homedir(), ".omp", "sync-log.jsonl");

const args = process.argv.slice(2);
const doRebuild = args.includes("--rebuild");
const stayOnWip = args.includes("--stay-on-wip");

function flagValue(name: string): string | undefined {
	const idx = args.indexOf(name);
	return idx >= 0 ? args[idx + 1] : undefined;
}
/** Consume pre-resolved overlay contents from this directory (mirrors repo layout). */
const overlaysFrom = flagValue("--overlays-from");
/** Write conflicted 3-way results (with markers) into this directory instead of dying blind. */
const dumpConflicts = flagValue("--dump-conflicts");

function print(msg: string) {
	process.stdout.write(msg + "\n");
}

function section(title: string) {
	print(`\n=== ${title} ===`);
}

function die(msg: string): never {
	print(`ERROR: ${msg}`);
	process.exit(1);
}

// ─── Registry loading / matching (copied from sync.ts — cannot import, it runs main() at load) ──

async function loadRegistry(): Promise<Registry> {
	const text = await Bun.file(registryPath).text();
	return Bun.YAML.parse(text) as Registry;
}

function matchPathAgainstPatterns(file: string, patterns: string[]): boolean {
	for (const pat of patterns) {
		if (pat === file) return true;
		if (pat.endsWith("/") && file.startsWith(pat)) return true;
		if (pat.includes("*")) {
			const regex = new RegExp("^" + pat.replace(/\*\*/g, "<<<DOUBLESTAR>>>").replace(/\*/g, "[^/]*").replace(/<<<DOUBLESTAR>>>/g, ".*") + "$");
			if (regex.test(file)) return true;
		}
	}
	return false;
}

function findOwningFeatures(registry: Registry, file: string): Feature[] {
	return registry.features.filter(f => f.owned_paths.some(p => matchPathAgainstPatterns(file, [p])));
}

function findDivergence(registry: Registry, file: string): Divergence | undefined {
	return registry.divergences?.find(d => matchPathAgainstPatterns(file, [d.path]));
}

// ─── Git helpers ────────────────────────────────────────────────────────────

async function gitBranch(): Promise<string> {
	return (await $`git branch --show-current`.cwd(root).quiet().text()).trim();
}

async function gitStatus(): Promise<string> {
	return (await $`git status --porcelain`.cwd(root).quiet().text()).trim();
}

async function gitRevParse(ref: string): Promise<string> {
	return (await $`git rev-parse ${ref}`.cwd(root).quiet().text()).trim();
}

async function gitRevParseShort(ref: string): Promise<string> {
	return (await $`git rev-parse --short ${ref}`.cwd(root).quiet().text()).trim();
}

async function gitMergeBase(left: string, right: string): Promise<string> {
	return (await $`git merge-base ${left} ${right}`.cwd(root).quiet().text()).trim();
}

async function gitCatFileExists(ref: string): Promise<boolean> {
	const result = await $`git cat-file -e ${ref}`.cwd(root).quiet().nothrow();
	return result.exitCode === 0;
}

async function nameStatus(revisions: string[]): Promise<DeltaRow[]> {
	const text = (
		await $`git diff --name-status --no-renames ${revisions}`.cwd(root).quiet().text()
	).trim();
	return text
		.split("\n")
		.filter(Boolean)
		.map(line => {
			const tab = line.indexOf("\t");
			return { status: line.slice(0, tab), file: line.slice(tab + 1) };
		});
}

async function diffNameOnly(revisionPair: string): Promise<string[]> {
	const text = (await $`git diff --name-only --no-renames ${revisionPair}`.cwd(root).quiet().text()).trim();
	return text ? text.split("\n").filter(Boolean) : [];
}

async function deletingCommitLine(range: string, file: string): Promise<string> {
	return (
		await $`git log --diff-filter=D --format=${"%h %s"} -n1 ${range} -- ${file}`.cwd(root).quiet().text()
	).trim();
}

// Tag helpers + collision logic (copied from sync.ts resolveTagName)
async function gitTagExists(name: string): Promise<boolean> {
	const result = await $`git rev-parse --verify refs/tags/${name}`.cwd(root).quiet().nothrow();
	return result.exitCode === 0;
}

async function resolveTagName(base: string): Promise<string> {
	if (!(await gitTagExists(base))) return base;
	let n = 1;
	while (await gitTagExists(`${base}-${n}`)) {
		n++;
	}
	return `${base}-${n}`;
}

async function gitTagCreate(name: string, ref: string, message: string): Promise<void> {
	await $`git tag -a ${name} ${ref} -m ${message}`.cwd(root).quiet();
}

// ─── State (same files/format as sync.ts; atomic tmp+rename like its writeState) ──

async function writeState(state: SyncState): Promise<void> {
	const tmp = STATE_PATH + ".tmp";
	await Bun.write(tmp, JSON.stringify(state, null, 2));
	await fs.rename(tmp, STATE_PATH);
}

async function appendLog(entry: LogEntry): Promise<void> {
	await fs.appendFile(LOG_PATH, JSON.stringify(entry) + "\n");
}

// ─── Delta classification (shared by triage and rebuild) ────────────────────

async function classify(
	registry: Registry,
	base: string,
	mainRef: string,
	withForensics: boolean,
): Promise<Classification> {
	const delta = await nameStatus([`${base}..${mainRef}`]);
	const upstreamChanged = new Set(await diffNameOnly(`${base}..upstream/main`));
	const removalPatterns = (registry.removals ?? []).map(r => r.path);

	const cls: Classification = {
		converged: [],
		registered: [],
		accidentalCandidates: [],
		forkOwned: new Map(),
		overlayFiles: new Set(),
		divergenceCovered: new Set(),
		divergencePreferOurs: new Set(),
		autoRestored: new Set(),
		unregistered: [],
	};

	for (const row of delta) {
		if (row.status.startsWith("D")) {
			if (!(await gitCatFileExists(`upstream/main:${row.file}`))) {
				cls.converged.push(row.file);
			} else if (matchPathAgainstPatterns(row.file, removalPatterns)) {
				cls.registered.push(row.file);
			} else {
				cls.accidentalCandidates.push({
					file: row.file,
					commit: withForensics ? await deletingCommitLine(`${base}..${mainRef}`, row.file) : "",
				});
				cls.autoRestored.add(row.file);
			}
			continue;
		}

		const div = findDivergence(registry, row.file);
		// Explicit prefer_upstream divergences beat blanket package ownership
		// (e.g. packages/*/CHANGELOG.md shadowed by "OWP coding-agent package").
		if (div?.resolution === "prefer_upstream") {
			cls.divergenceCovered.add(row.file);
			continue;
		}

		const owners = findOwningFeatures(registry, row.file);
		if (owners.length > 0) {
			// Multiple owners → first registry match wins.
			const owner = owners[0];
			if (!cls.forkOwned.has(owner.name)) cls.forkOwned.set(owner.name, new Set());
			cls.forkOwned.get(owner.name)!.add(row.file);
			if (row.status.startsWith("M") && upstreamChanged.has(row.file)) {
				cls.overlayFiles.add(row.file);
			}
			if (div) cls.divergencePreferOurs.add(row.file);
		} else if (div) {
			// prefer_ours divergence with no feature owner: keep the fork's file.
			if (!cls.forkOwned.has(DIVERGENCE_OURS_BUCKET)) cls.forkOwned.set(DIVERGENCE_OURS_BUCKET, new Set());
			cls.forkOwned.get(DIVERGENCE_OURS_BUCKET)!.add(row.file);
			if (row.status.startsWith("M") && upstreamChanged.has(row.file)) {
				cls.overlayFiles.add(row.file);
			}
			cls.divergencePreferOurs.add(row.file);
		} else {
			cls.unregistered.push({ file: row.file, status: row.status });
		}
	}

	return cls;
}

// ─── Triage mode (read-only report) ─────────────────────────────────────────

async function triage(registry: Registry) {
	const mainShort = await gitRevParseShort("main");
	const upstreamShort = await gitRevParseShort("upstream/main");
	const base = await gitMergeBase("upstream/main", "main");

	section("Heads");
	print(`main:          ${mainShort}`);
	print(`upstream/main: ${upstreamShort}`);
	print(`merge-base:    ${await gitRevParseShort(base)}${base === (await gitRevParse("upstream/main")) ? "  (= upstream/main, fork fully synced)" : ""}`);

	const cls = await classify(registry, base, "main", true);

	section("Deletion adjudication");
	print(
		`converged (gone upstream too): ${cls.converged.length}` +
			`\nregistered (§ removals):       ${cls.registered.length}` +
			`\naccidental candidates:         ${cls.accidentalCandidates.length}`,
	);
	if (cls.converged.length > 0) {
		print("\nConverged:");
		for (const f of cls.converged) print(`  ${f}`);
	}
	if (cls.registered.length > 0) {
		print("\nRegistered:");
		for (const f of cls.registered) print(`  ${f}`);
	}
	if (cls.accidentalCandidates.length > 0) {
		print("\nAccidental candidates (deleted vs upstream, not registered — default policy: restore):");
		for (const c of cls.accidentalCandidates) {
			print(`  ${c.file}${c.commit ? `  [deleted by ${c.commit}]` : "  [deleting commit outside range]"}`);
		}
		print(
			"\nSeed intentional ones into feature-registry.yaml § removals (group by deleting commit;" +
				"\nsubjects matching remove/delete/drop qualify). The rest will be auto-restored on rebuild.",
		);
	}

	section("Partition preview (per feature)");
	const delta = await nameStatus([`${base}..main`]);
	const upstreamChanged = new Set(await diffNameOnly(`${base}..upstream/main`));
	let previewed = 0;
	for (const feature of registry.features) {
		const counts = { A: 0, M: 0, sharedM: 0, D: 0 };
		for (const row of delta) {
			const owners = findOwningFeatures(registry, row.file);
			if (owners.length === 0 || owners[0].name !== feature.name) continue;
			if (row.status.startsWith("D")) counts.D++;
			else if (row.status.startsWith("M")) {
				counts.M++;
				if (upstreamChanged.has(row.file)) counts.sharedM++;
			} else if (row.status.startsWith("A")) counts.A++;
		}
		const total = counts.A + counts.M + counts.D;
		if (total === 0) continue;
		previewed++;
		print(
			`${feature.name}: A=${counts.A} M=${counts.M} shared-M=${counts.sharedM} D=${counts.D}`,
		);
	}
	if (previewed > 0) print("(first-owner attribution; shared-M = also modified upstream)");

	section("Unregistered additions/modifications (would abort rebuild)");
	if (cls.unregistered.length === 0) {
		print("(none — every A/M file maps to a feature or divergence)");
	} else {
		for (const u of cls.unregistered) {
			print(`  ${u.status}  ${u.file}`);
		}
	}

	process.exit(0);
}

// ─── Rebuild helpers ────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

/** Build 3-way merges for shared files BEFORE touching the worktree. Returns merged contents.
 *
 * fromDir:   directory mirroring repo layout; a file present there replaces the
 *            merge entirely (must be marker-free — it is a human resolution).
 * scratchDir: when set, conflicted merge results (with markers) are written here
 *            for manual resolution instead of only being listed.
 */
async function buildOverlays(
	overlayFiles: Set<string>,
	base: string,
	oldMain: string,
	fromDir?: string,
	scratchDir?: string,
): Promise<{ merged: Map<string, Buffer>; conflicts: string[] }> {
	const merged = new Map<string, Buffer>();
	const conflicts: string[] = [];
	if (overlayFiles.size === 0) return { merged, conflicts };

	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reorg-overlay-"));
	try {
		let idx = 0;
		for (const file of [...overlayFiles].sort()) {
			const fromPath = fromDir ? path.join(fromDir, file) : null;
			if (fromPath && (await fs.stat(fromPath).then(
				s => s.isFile(),
				() => false,
			))) {
				const bytes = await fs.readFile(fromPath);
				if (hasConflictMarkers(bytes)) die(`resolved overlay still contains conflict markers: ${file}`);
				merged.set(file, bytes);
				continue;
			}

			idx++;
			const oursP = path.join(tmpDir, `${idx}.ours`);
			const baseP = path.join(tmpDir, `${idx}.base`);
			const theirsP = path.join(tmpDir, `${idx}.theirs`);
			await fs.writeFile(oursP, await $`git show ${oldMain}:${file}`.cwd(root).quiet().bytes());
			await fs.writeFile(baseP, await $`git show ${base}:${file}`.cwd(root).quiet().bytes());
			await fs.writeFile(theirsP, await $`git show upstream/main:${file}`.cwd(root).quiet().bytes());

			const mf = await $`git merge-file -L ours -L base -L theirs ${oursP} ${baseP} ${theirsP}`
				.cwd(root)
				.quiet()
				.nothrow();
			if (mf.exitCode !== 0) {
				conflicts.push(file);
				if (scratchDir) {
					const out = path.join(scratchDir, file);
					await fs.mkdir(path.dirname(out), { recursive: true });
					await fs.writeFile(out, await fs.readFile(oursP));
				}
				continue;
			}
			merged.set(file, await fs.readFile(oursP));
		}
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true });
	}
	return { merged, conflicts };
}

async function stagedFiles(): Promise<string[]> {
	const text = (await $`git diff --cached --name-only`.cwd(root).quiet().text()).trim();
	return text ? text.split("\n").filter(Boolean) : [];
}

interface VerifyParsed {
	conflictMarkers?: { ok?: boolean };
	symbolHealth?: { ok?: boolean };
	commitSurvival?: { ok?: boolean };
	typeCheck?: { ok?: boolean };
	nativeSentinel?: { ok?: boolean };
	deletionAudit?: { ok?: boolean; violations?: string[] };
}

/** Run sync.ts --verify and parse its trailing JSON block. */
async function runVerifySuite(): Promise<{ failed: boolean; parsed: VerifyParsed | null }> {
	const proc = await $`bun .omp/skills/sync-upstream/sync.ts --verify`.cwd(root).quiet().nothrow();
	const text = proc.text();
	const marker = text.lastIndexOf("--- JSON ---");
	let parsed: VerifyParsed | null = null;
	if (marker !== -1) {
		try {
			parsed = JSON.parse(text.slice(marker + "--- JSON ---".length)) as VerifyParsed;
		} catch {
			parsed = null;
		}
	}
	return { failed: proc.exitCode !== 0, parsed };
}

// ─── Rebuild mode ───────────────────────────────────────────────────────────

async function rebuild(
	registry: Registry,
	opts: { overlaysFrom?: string; dumpConflicts?: string } = {},
) {
	const startedAt = new Date();

	// 1. Preflight — abort = print error, exit non-zero, touch nothing.
	section("Pre-flight");
	const branch = await gitBranch();
	if (branch !== "main") die(`not on main branch (current: ${branch}). Run from a clean main checkout.`);
	const status = await gitStatus();
	if (status) die(`working tree has uncommitted changes:\n${status}`);
	if (!(await gitCatFileExists("upstream/main"))) die("upstream/main does not exist.");
	print("OK: on main, clean working tree, upstream/main present");

	// 2. Backup tag on old main.
	const oldMain = await gitRevParse("main");
	const oldMainShort = await gitRevParseShort(oldMain);
	const dateTag = startedAt.toISOString().slice(0, 10);
	const backupTag = await resolveTagName(`backup/pre-reorg-${dateTag}`);
	await gitTagCreate(backupTag, oldMain, `Pre-reorg backup of main (${oldMainShort})`);
	print(`Backup tag: ${backupTag} -> ${oldMainShort}`);

	// 3. Classify the full delta.
	section("Classify delta");
	const base = await gitMergeBase("upstream/main", "main");
	const cls = await classify(registry, base, oldMain, false);

	if (cls.unregistered.length > 0) {
		print("The following additions/modifications are covered by neither features nor divergences:");
		for (const u of cls.unregistered) print(`  ${u.status}  ${u.file}`);
		die("register these files in feature-registry.yaml first, then re-run.");
	}
	print(
		`fork-owned files: ${[...cls.forkOwned.values()].reduce((n, s) => n + s.size, 0)}` +
			`\noverlays (3-way): ${cls.overlayFiles.size}` +
			`\ndivergence-covered (take upstream): ${cls.divergenceCovered.size}` +
			`\nremovals (§ removals): ${cls.registered.length}` +
			`\nauto-restored (unregistered deletions): ${cls.autoRestored.size}` +
			`\nconverged (gone upstream too): ${cls.converged.length}`,
	);

	// Baseline verification on the pre-reorg tree: the post-rebuild gate requires
	// no NEW failures relative to this (repos with pre-existing red checks stay
	// completable; regressions do not).
	const baseline = await runVerifySuite();
	if (baseline.parsed) {
		const bad = (["conflictMarkers", "symbolHealth", "commitSurvival", "typeCheck", "nativeSentinel"] as const)
			.filter(s => baseline.parsed![s]?.ok === false);
		print(`Baseline verify: ${bad.length === 0 ? "all sections pass" : `pre-existing failures: ${bad.join(", ")}`}`);
	} else {
		print("Baseline verify: could not parse report — post-rebuild gate will require all sections to pass.");
	}

	// 4. Build all overlays BEFORE touching the worktree; conflicts abort cleanly.
	const { merged: overlayContent, conflicts } = await buildOverlays(
		cls.overlayFiles,
		base,
		oldMain,
		opts.overlaysFrom,
		opts.dumpConflicts,
	);
	if (conflicts.length > 0) {
		print(`3-way merge conflicts in ${conflicts.length} shared file(s) (nothing staged):`);
		for (const f of conflicts) print(`  ${f}`);
		if (opts.dumpConflicts) {
			die(
				`conflicted results dumped with markers under ${opts.dumpConflicts}\n` +
					"resolve each file (remove all <<</===/>>> markers), then re-run with:\n" +
					`  organize.ts --rebuild --overlays-from ${opts.dumpConflicts}`,
			);
		}
		die("3-way merge conflicts in shared files (nothing staged). Re-run with --dump-conflicts <dir>.");
	}

	// 5. Branch from upstream/main — the rebuilt history starts there.
	const co = await $`git checkout -b reorganize-wip upstream/main`.cwd(root).nothrow();
	if (co.exitCode !== 0) die(`could not create reorganize-wip from upstream/main:\n${co.stderr.text()}`);

	// 6. One topical commit per feature, in registry order.
	section("Feature commits");
	let committedFeatures = 0;
	for (const feature of registry.features) {
		const files = [...(cls.forkOwned.get(feature.name) ?? [])].sort();
		if (files.length === 0) {
			print(`skip (no files): ${feature.name}`);
			continue;
		}
		for (const part of chunk(files, 50)) {
			const restore = await $`git restore --source=${oldMain} --staged --worktree -- ${part}`
				.cwd(root)
				.quiet()
				.nothrow();
			if (restore.exitCode !== 0) die(`git restore failed for ${feature.name}:\n${restore.stderr.text()}`);
		}
		for (const ov of files.filter(f => overlayContent.has(f))) {
			await Bun.write(path.join(root, ov), overlayContent.get(ov)!);
			const add = await $`git add -- ${ov}`.cwd(root).quiet().nothrow();
			if (add.exitCode !== 0) die(`git add failed for overlay ${ov}`);
		}
		const staged = await stagedFiles();
		if (staged.length === 0) {
			print(`skip (nothing staged): ${feature.name}`);
			continue;
		}
		const subject = `feat(owp): ${feature.name}`;
		const commit = feature.description
			? await $`git commit -q -m ${subject} -m ${feature.description}`.cwd(root).quiet().nothrow()
			: await $`git commit -q -m ${subject}`.cwd(root).quiet().nothrow();
		if (commit.exitCode !== 0) die(`git commit failed for ${feature.name}:\n${commit.stderr.text()}`);
		committedFeatures++;
		print(`committed (${staged.length} files): ${subject}`);
	}

	// 6b. prefer_ours divergences without a feature owner — restore the fork's files verbatim.
	const divergenceFiles = [...(cls.forkOwned.get(DIVERGENCE_OURS_BUCKET) ?? [])].sort();
	if (divergenceFiles.length > 0) {
		for (const part of chunk(divergenceFiles, 50)) {
			const restore = await $`git restore --source=${oldMain} --staged --worktree -- ${part}`
				.cwd(root)
				.quiet()
				.nothrow();
			if (restore.exitCode !== 0) die(`git restore failed for prefer-ours divergences:\n${restore.stderr.text()}`);
		}
		for (const ov of divergenceFiles.filter(f => overlayContent.has(f))) {
			await Bun.write(path.join(root, ov), overlayContent.get(ov)!);
			const add = await $`git add -- ${ov}`.cwd(root).quiet().nothrow();
			if (add.exitCode !== 0) die(`git add failed for overlay ${ov}`);
		}
		const staged = await stagedFiles();
		if (staged.length > 0) {
			await $`git commit -q -m ${"chore(owp): retain prefer-ours divergence files"}`.cwd(root).quiet().nothrow();
			print(`committed (${staged.length} files): chore(owp): retain prefer-ours divergence files`);
		}
	}

	// 7. Intentional removals. Each pattern is applied to the classified deletion
	// set only and removed by exact path, so a directory/glob pattern never
	// deletes surviving fork files under the same directory.
	section("Removals");
	let committedRemovals = 0;
	for (const removal of registry.removals ?? []) {
		const targets = cls.registered.filter(f => matchPathAgainstPatterns(f, [removal.path])).sort();
		for (const part of chunk(targets, 50)) {
			const rm = await $`git rm -q --ignore-unmatch -- ${part}`.cwd(root).quiet().nothrow();
			if (rm.exitCode !== 0) die(`git rm failed for ${removal.path}:\n${rm.stderr.text()}`);
		}
		const staged = await stagedFiles();
		if (staged.length === 0) {
			print(`skip (nothing matched): ${removal.path}`);
			continue;
		}
		const subject = `chore(owp): remove ${removal.path} — ${removal.reason}`;
		const commit = await $`git commit -q -m ${subject}`.cwd(root).quiet().nothrow();
		if (commit.exitCode !== 0) die(`git commit failed for removal ${removal.path}:\n${commit.stderr.text()}`);
		committedRemovals++;
		print(`committed (${staged.length} files): ${subject}`);
	}

	// 8. Integrity gate — provenance-based. Every difference between the wip
	// tree and upstream/main must be attributable to a fork category (owned
	// file, merged overlay, prefer_ours divergence) or be a registered
	// removal. Restored files must match upstream byte-for-byte; registered
	// removals must actually be gone. (Diffing against old main would flag
	// thousands of legitimate upstream-evolution rows whenever upstream has
	// moved past the old sync base.)
	section("Integrity gate");
	const rows = await nameStatus(["reorganize-wip", "upstream/main"]);
	const forkTouched = new Set<string>();
	for (const files of cls.forkOwned.values()) {
		for (const f of files) forkTouched.add(f);
	}
	const removedSet = new Set(cls.registered);
	const seen = new Map<string, number>();
	const violations: string[] = [];
	for (const row of rows) {
		seen.set(row.file, (seen.get(row.file) ?? 0) + 1);
		// Diff direction is wip -> upstream/main: a file upstream has that the
		// wip tree lacks (a registered removal) surfaces as "A".
		const isRegisteredRemoval = removedSet.has(row.file) && row.status.startsWith("A");
		if (!isRegisteredRemoval && !forkTouched.has(row.file)) violations.push(`${row.status}  ${row.file}`);
	}
	for (const f of removedSet) {
		const n = seen.get(f) ?? 0;
		if (n === 1) continue; // present exactly once as a D row
		violations.push(n === 0 ? `registered removal not applied: ${f}` : `appears more than once in diff: ${f}`);
	}
	for (const f of cls.autoRestored) {
		const n = seen.get(f) ?? 0;
		if (n > 0) violations.push(`restored file differs from upstream/main: ${f}`);
	}
	for (const [f, n] of seen) {
		if (n > 1) violations.push(`appears more than once in diff: ${f}`);
	}
	if (violations.length > 0) {
		print("Unexpected differences between reorganize-wip and pre-reorg main:");
		for (const v of violations) print(`  ${v}`);
		die("integrity gate failed — reorganize-wip left in place for inspection.");
	}
	print(
		`OK: all ${rows.length} difference(s) vs upstream/main are fork-attributable` +
			` (owned files, overlays, prefer-ours divergences, registered removals)`,
	);

	// 9. Verification gate: no NEW failures vs the pre-reorg baseline. The
	// deletion audit reads the `main` ref, which still swaps afterwards — so it
	// may flag exactly the files this rebuild restores, nothing else.
	section("Verification");
	const wip = await runVerifySuite();
	const sections = ["conflictMarkers", "symbolHealth", "commitSurvival", "typeCheck", "nativeSentinel"] as const;
	const problems: string[] = [];
	for (const s of sections) {
		const nowBad = wip.parsed ? wip.parsed[s]?.ok === false : true;
		const wasBad = baseline.parsed ? baseline.parsed[s]?.ok === false : true;
		if (nowBad && !wasBad) problems.push(`new failure in ${s}`);
	}
	const auditViolations = wip.parsed?.deletionAudit?.violations ?? [];
	if (!wip.parsed?.deletionAudit || !auditViolations.every(f => cls.autoRestored.has(f))) {
		problems.push(`deletion audit flags non-restored file(s): ${auditViolations.filter(f => !cls.autoRestored.has(f)).join(", ") || "unparseable report"}`);
	}
	if (problems.length > 0) {
		for (const p of problems) print(`  ${p}`);
		die("verification regressed vs baseline — reorganize-wip left in place for inspection.");
	}
	const inherited = sections.filter(s => wip.parsed?.[s]?.ok === false);
	print(`OK: no new verification failures${inherited.length > 0 ? ` (inherited from baseline: ${inherited.join(", ")})` : ""}`);

	// 10. Swap or stop.
	if (stayOnWip) {
		print(`\nStaying on reorganize-wip (--stay-on-wip). Backup tag: ${backupTag}`);
		print("Inspect:");
		print("  git log --oneline upstream/main..reorganize-wip");
		print("  git diff --name-status reorganize-wip main");
		print("Finalize (rewrites history):");
		print("  git checkout main && git reset --hard reorganize-wip && git branch -D reorganize-wip");
		print("Discard the test artifact:");
		print(`  git checkout main && git branch -D reorganize-wip && git tag -d ${backupTag}`);
		return;
	}

	await $`git checkout main`.cwd(root).quiet().nothrow();
	await $`git reset --hard reorganize-wip`.cwd(root).quiet().nothrow();
	await $`git branch -D reorganize-wip`.cwd(root).quiet().nothrow();

	const restoredList = [...cls.autoRestored].sort();
	print(`\nReorganization complete: ${committedFeatures} feature commit(s), ${committedRemovals} removal commit(s).`);
	if (restoredList.length > 0) {
		print(`Restored ${restoredList.length} accidentally-deleted file(s) from upstream/main:`);
		for (const f of restoredList) print(`  ${f}`);
	}

	const syncId = `reorg-${startedAt.toISOString().slice(0, 10).replace(/-/g, "")}-${oldMainShort}`;
	const state: SyncState = {
		repoPath: root,
		preSyncHead: oldMain,
		preSyncHeadShort: oldMainShort,
		upstreamHead: await gitRevParseShort("upstream/main"),
		upstreamBase: base,
		startedAt: startedAt.toISOString(),
		status: "completed",
		syncId,
		observations: [
			`topical rebuild: ${committedFeatures} feature commits, ${committedRemovals} removals`,
			`restored ${restoredList.length} deleted files`,
			`backup tag ${backupTag}`,
		],
	};
	await writeState(state);
	await appendLog({ ...state, finishedAt: new Date().toISOString() });

	print("\nHistory was rewritten — force-push with:");
	print("  git push origin main --force-with-lease");
	print(`(rollback point: ${backupTag}; sync.ts --revert also available)`);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

async function main() {
	const registry = await loadRegistry();
	if (doRebuild) await rebuild(registry, { overlaysFrom, dumpConflicts });
	else await triage(registry);
}

main().catch(err => {
	print(String(err));
	process.exit(1);
});
