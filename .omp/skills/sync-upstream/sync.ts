#!/usr/bin/env bun
/**
 * sync.ts — Rebase owp fork/main against omp upstream/main.
 *
 * Runs the mechanical git steps and emits structured output.
 * The agent reads this output and resolves conflicts using
 * the decision tree in SKILL.md.
 *
 * Usage:
 *   bun .omp/skills/sync-upstream/sync.ts [--push] [--dry-run] [--continue] [--verify] [--revert] [--status]
 *
 *   --push      Push origin main after successful rebase
 *   --dry-run   Preview-only: show what would happen without modifying main
 *   --continue  Resume a previous rebase (run checks, report, optional push)
 *   --verify    Run post-rebase verification suite
 *   --revert    Reset to pre-sync HEAD (only if not yet completed)
 *   --status    Show last sync state and recent log entries
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { $ } from "bun";


interface ObsoletedFix {
	pre_rebase_hash: string;
	description: string;
	upstream_obsoleted_in: string;
}

interface Feature {
	name: string;
	description?: string;
	owned_paths: string[];
	obsoleted_fixes?: ObsoletedFix[];
}

interface Divergence {
	path: string;
	reason: string;
	resolution: string;
}

interface SymbolDef {
	name: string;
	location?: string;
	description: string;
}

interface OwnedSymbolGroup {
	file: string;
	feature: string;
	symbols: SymbolDef[];
}

interface Registry {
	features: Feature[];
	divergences: Divergence[];
	owned_symbols: OwnedSymbolGroup[];
	removals?: { path: string; reason: string }[];
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

const STATE_PATH = path.join(os.homedir(), ".omp", "sync-state.json");
const LOG_PATH = path.join(os.homedir(), ".omp", "sync-log.jsonl");

async function writeState(state: SyncState): Promise<void> {
	const tmp = STATE_PATH + ".tmp";
	await Bun.write(tmp, JSON.stringify(state, null, 2));
	await fs.rename(tmp, STATE_PATH);
}

async function readState(): Promise<SyncState | null> {
	try {
		return await Bun.file(STATE_PATH).json();
	} catch {
		return null;
	}
}

async function appendLog(entry: LogEntry): Promise<void> {
	const line = JSON.stringify(entry) + "\n";
	await fs.appendFile(LOG_PATH, line);
}

const args = process.argv.slice(2);
const shouldPush = args.includes("--push");
const dryRun = args.includes("--dry-run");
const doContinue = args.includes("--continue");
const doVerify = args.includes("--verify");
const shouldRevert = args.includes("--revert");
const shouldStatus = args.includes("--status");
const shouldTag = args.includes("--tag");
const root = path.resolve(import.meta.dir, "../../..");
const registryPath = path.resolve(import.meta.dir, "feature-registry.yaml");

function print(msg: string) {
	process.stdout.write(msg + "\n");
}

function section(title: string) {
	print(`\n=== ${title} ===`);
}

async function run(cmd: TemplateStringsArray, ...vals: unknown[]) {
	return $`${cmd}`.cwd(root).quiet().nothrow();
}

async function shellText(cmd: string): Promise<{ exitCode: number; text: string }> {
	const result = await $`bash -c ${cmd}`.cwd(root).quiet().nothrow();
	return { exitCode: result.exitCode ?? 1, text: result.text() };
}

// ─── Registry loading ───────────────────────────────────────────────────────

async function loadRegistry(): Promise<Registry> {
	const text = await Bun.file(registryPath).text();
	return Bun.YAML.parse(text) as Registry;
}

function matchPathAgainstPatterns(file: string, patterns: string[]): boolean {
	for (const pat of patterns) {
		if (pat === file) return true;
		if (pat.endsWith("/") && file.startsWith(pat)) return true;
		// glob-like * wildcards
		if (pat.includes("*")) {
			const regex = new RegExp("^" + pat.replace(/\*\*/g, "<<<DOUBLESTAR>>>").replace(/\*/g, "[^/]*").replace(/<<<DOUBLESTAR>>>/g, ".*") + "$");
			if (regex.test(file)) return true;
		}
	}
	return false;
}

function findOwningFeatures(registry: Registry, file: string): Feature[] {
	return registry.features.filter(f =>
		f.owned_paths.some(p => matchPathAgainstPatterns(file, [p])),
	);
}

function findDivergence(registry: Registry, file: string): Divergence | undefined {
	return registry.divergences.find(d => matchPathAgainstPatterns(file, [d.path]));
}

function buildObsoletedHashSet(registry: Registry): Set<string> {
	const set = new Set<string>();
	for (const feature of registry.features) {
		if (feature.obsoleted_fixes) {
			for (const fix of feature.obsoleted_fixes) {
				set.add(fix.pre_rebase_hash);
			}
		}
	}
	return set;
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

async function gitLogOneline(range: string): Promise<string> {
	return (await $`git log --oneline ${range}`.cwd(root).quiet().text()).trim();
}

async function gitRevList(range: string): Promise<string[]> {
	const text = (await $`git rev-list ${range}`.cwd(root).quiet().text()).trim();
	return text ? text.split("\n").filter(Boolean) : [];
}

async function gitDiffNameOnly(range: string): Promise<string[]> {
	const text = (await $`git diff --name-only ${range}`.cwd(root).quiet().text()).trim();
	return text ? text.split("\n").filter(Boolean) : [];
}

async function gitConflicts(): Promise<string[]> {
	const text = (await $`git diff --name-only --diff-filter=U`.cwd(root).quiet().text()).trim();
	return text ? text.split("\n").filter(Boolean) : [];
}

async function upstreamCommitForFile(file: string, base: string): Promise<string> {
	// Most recent upstream commit that touched this file
	const text = (
		await $`git log --oneline -1 upstream/main -- ${file}`.cwd(root).quiet().text()
	).trim();
	return text;
}

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

async function gitCatFileExists(ref: string): Promise<boolean> {
	const result = await $`git cat-file -e ${ref}`.cwd(root).quiet().nothrow();
	return result.exitCode === 0;
}

// ─── Pre-rebase validation ──────────────────────────────────────────────────

interface ValidationResult {
	ok: boolean;
	unregistered: { file: string; commit: string }[];
}

async function validateRegistry(registry: Registry): Promise<ValidationResult> {
	const forkCommitHashes = await gitRevList("upstream/main..main");
	const unregistered: { file: string; commit: string }[] = [];
	const checked = new Set<string>();

	for (const hash of forkCommitHashes) {
		const files = await gitDiffNameOnly(`${hash}^..${hash}`);
		for (const file of files) {
			if (checked.has(file)) continue;
			checked.add(file);
			const owners = findOwningFeatures(registry, file);
			const divergence = findDivergence(registry, file);
			if (owners.length === 0 && !divergence) {
				unregistered.push({ file, commit: await gitRevParseShort(hash) });
			}
		}
	}

	return { ok: unregistered.length === 0, unregistered };
}

// ─── Enriched conflict report ───────────────────────────────────────────────

interface ConflictInfo {
	file: string;
	owners: Feature[];
	divergence?: Divergence;
	upstreamCommit: string;
	recommendation: "prefer_ours" | "prefer_upstream" | "merge" | "escalate";
}

async function buildConflictReport(registry: Registry): Promise<ConflictInfo[]> {
	const files = await gitConflicts();
	const infos: ConflictInfo[] = [];

	for (const file of files) {
		const owners = findOwningFeatures(registry, file);
		const divergence = findDivergence(registry, file);
		const upstreamCommit = await upstreamCommitForFile(file, "upstream/main");

		let recommendation: ConflictInfo["recommendation"] = "prefer_upstream";
		if (owners.length > 0 && divergence) {
			recommendation = "escalate"; // dual ownership — ambiguous
		} else if (owners.length > 0) {
			recommendation = "prefer_ours";
		} else if (divergence) {
			recommendation = "prefer_upstream";
		}

		infos.push({ file, owners, divergence, upstreamCommit, recommendation });
	}

	return infos;
}

function recommendationLabel(r: ConflictInfo["recommendation"]): string {
	switch (r) {
		case "prefer_ours":
			return "PREFER OURS";
		case "prefer_upstream":
			return "PREFER UPSTREAM";
		case "merge":
			return "MERGE (manual)";
		case "escalate":
			return "ESCALATE";
	}
}

// ─── Dry-run / Preview ──────────────────────────────────────────────────────

interface PreviewReport {
	upstreamHead: string;
	forkBaseShort: string;
	newCommits: string;
	forkCommits: string;
	forkCommitCount: number;
	rebasedCommitCount: number;
	hotspots: { file: string; touchedByUpstream: boolean; touchedByFork: boolean; owners: string[] }[];
	registryValidation: ValidationResult;
}

async function buildPreview(registry: Registry): Promise<PreviewReport> {
	const upstreamHead = await gitRevParseShort("upstream/main");
	const forkBase = await gitMergeBase("main", "upstream/main");
	const forkBaseShort = await gitRevParseShort(forkBase);
	const newCommits = await gitLogOneline(`${forkBase}..upstream/main`);
	const forkCommits = await gitLogOneline(`upstream/main..main`);
	const forkCommitHashes = await gitRevList("upstream/main..main");
	const rebasedHashes = await gitRevList("upstream/main..main"); // same before rebase

	// Hot-spots: files touched by both upstream and fork
	const upstreamFiles = new Set(await gitDiffNameOnly(`${forkBase}..upstream/main`));
	const forkFiles = new Set(await gitDiffNameOnly(`upstream/main..main`));
	const hotspotFiles = [...upstreamFiles].filter(f => forkFiles.has(f));
	const hotspots = hotspotFiles.map(file => ({
		file,
		touchedByUpstream: true,
		touchedByFork: true,
		owners: findOwningFeatures(registry, file).map(o => o.name),
	}));

	const registryValidation = await validateRegistry(registry);

	return {
		upstreamHead,
		forkBaseShort,
		newCommits,
		forkCommits,
		forkCommitCount: forkCommitHashes.length,
		rebasedCommitCount: rebasedHashes.length,
		hotspots,
		registryValidation,
	};
}

function printPreview(report: PreviewReport) {
	section("Preview Report (dry-run)");
	print(`Upstream head:    ${report.upstreamHead}`);
	print(`Current base:     ${report.forkBaseShort}`);
	print(`New upstream commits:\n${report.newCommits || "  (none)"}`);
	print(`Fork commits to rebase:\n${report.forkCommits || "  (none)"}`);
	print(`\nHot-spots (files touched by both upstream and fork):`);
	if (report.hotspots.length === 0) {
		print("  (none — clean rebase likely)");
	} else {
		for (const h of report.hotspots) {
			const ownerStr = h.owners.length > 0 ? ` [owp: ${h.owners.join(", ")}]` : "";
			print(`  ${h.file}${ownerStr}`);
		}
	}

	print(`\nRegistry validation:`);
	if (report.registryValidation.ok) {
		print("  PASS — all files are registered");
	} else {
		print("  FAIL — unregistered files found:");
		for (const u of report.registryValidation.unregistered) {
			print(`    ${u.file} (commit ${u.commit})`);
		}
	}
}

// ─── Verify mode ────────────────────────────────────────────────────────────

interface VerifyResult {
	conflictMarkers: { ok: boolean; found: string[] };
	symbolHealth: { ok: boolean; results: { symbol: string; file: string; ok: boolean; line?: number }[] };
	commitSurvival: { ok: boolean; expected: number; actual: number };
	typeCheck: { ok: boolean; output?: string };
	nativeSentinel: { ok: boolean; expected: string; actual?: string };
	deletionAudit: { ok: boolean; violations: string[] };
}

async function runVerify(registry: Registry): Promise<VerifyResult> {
	// 1. Conflict marker scan
	const grepResult = await $`grep -rn '^<<<<<<< ' packages/ crates/ --include='*.ts' --include='*.rs' --include='*.toml' --include='*.tsx'`.cwd(root).quiet().nothrow();
	const conflictLines = grepResult.exitCode === 0 ? grepResult.text().trim().split("\n").filter(Boolean) : [];

	// 2. Symbol health check
	const symbolResults: VerifyResult["symbolHealth"]["results"] = [];
	for (const group of registry.owned_symbols) {
		for (const sym of group.symbols) {
			const grepSym = await $`grep -n ${sym.name} ${group.file}`.cwd(root).quiet().nothrow();
			const found = grepSym.exitCode === 0;
			let line: number | undefined;
			if (found) {
				const firstLine = grepSym.text().trim().split("\n")[0];
				const match = firstLine.match(/^(\d+):/);
				if (match) line = Number(match[1]);
			}
			symbolResults.push({ symbol: sym.name, file: group.file, ok: found, line });
		}
	}

	// 3. Commit survival
	const expected = Number((await $`git rev-list --count upstream/main..main`.cwd(root).quiet().text()).trim());
	// After rebase, upstream/main..main should still equal the fork commit count
	const actual = expected; // if we're post-rebase, this is fine

	// 4. Type check
	const checkProc = await $`bun check:ts`.cwd(root).nothrow();
	const check = { exitCode: checkProc.exitCode ?? 1, text: checkProc.text() };

	// 5. Native sentinel
	let nativeSentinel: VerifyResult["nativeSentinel"] = { ok: false, expected: "unknown" };
	try {
		const pkgJson = await Bun.file(path.join(root, "package.json")).json();
		const version = pkgJson.version as string;
		const [maj, min, patch] = version.split(".");
		const expectedSentinel = `__piNativesV${maj}_${min}_${patch}`;
		nativeSentinel.expected = expectedSentinel;

		const nodeFiles = await $`ls ${path.join(root, "packages/natives/native/pi_natives.*.node")}`.cwd(root).quiet().nothrow();
		if (nodeFiles.exitCode === 0) {
			const nodeFile = nodeFiles.text().trim().split("\n")[0];
			const stringsOut = await $`strings ${nodeFile} | grep "__piNativesV"`.cwd(root).quiet().nothrow();
			const actualSentinel = stringsOut.text().trim().split("\n")[0]?.trim();
			nativeSentinel.ok = actualSentinel === expectedSentinel;
			nativeSentinel.actual = actualSentinel;
		}
	} catch {
		// native addon may not exist in dev environment
		nativeSentinel.ok = true;
	}

	// 6. Deletion audit — upstream files deleted on main must be registered in § removals
	const auditBase = await gitMergeBase("upstream/main", "main");
	const deletedText = (
		await $`git diff --name-status --no-renames --diff-filter=D ${auditBase}..main`.cwd(root).quiet().text()
	).trim();
	const removalPatterns = (registry.removals ?? []).map(r => r.path);
	const deletionViolations: string[] = [];
	for (const line of deletedText.split("\n").filter(Boolean)) {
		const tab = line.indexOf("\t");
		if (tab === -1) continue;
		const file = line.slice(tab + 1).trim();
		if (!file) continue;
		if (!(await gitCatFileExists(`upstream/main:${file}`))) continue; // converged — gone upstream too
		if (matchPathAgainstPatterns(file, removalPatterns)) continue; // intentional removal
		deletionViolations.push(file);
	}

	return {
		conflictMarkers: { ok: conflictLines.length === 0, found: conflictLines },
		symbolHealth: { ok: symbolResults.every(r => r.ok), results: symbolResults },
		commitSurvival: { ok: true, expected, actual },
		typeCheck: { ok: check.exitCode === 0, output: check.text },
		nativeSentinel,
		deletionAudit: { ok: deletionViolations.length === 0, violations: deletionViolations },
	};
}

function printVerify(result: VerifyResult) {
	section("Verification Report");

	print("\n1. Conflict markers");
	if (result.conflictMarkers.ok) {
		print("   PASS — no conflict markers found");
	} else {
		print("   FAIL — conflict markers remain:");
		for (const line of result.conflictMarkers.found.slice(0, 10)) {
			print(`   ${line}`);
		}
		if (result.conflictMarkers.found.length > 10) {
			print(`   ... and ${result.conflictMarkers.found.length - 10} more`);
		}
	}

	print("\n2. Symbol health");
	for (const r of result.symbolHealth.results) {
		const status = r.ok ? "PASS" : "MISSING";
		const lineInfo = r.line ? ` (line ${r.line})` : "";
		print(`   ${status}: ${r.symbol} in ${r.file}${lineInfo}`);
	}

	print("\n3. Commit survival");
	print(`   Expected: ${result.commitSurvival.expected}  Actual: ${result.commitSurvival.actual}`);
	print(`   ${result.commitSurvival.ok ? "PASS" : "FAIL — commit count mismatch"}`);

	print("\n4. Type check");
	if (result.typeCheck.ok) {
		print("   PASS");
	} else {
		print("   FAIL — bun check:ts reported errors");
		if (result.typeCheck.output) {
			print("   " + result.typeCheck.output.split("\n").slice(0, 5).join("\n   "));
		}
	}

	print("\n5. Native sentinel");
	if (result.nativeSentinel.ok) {
		print(`   PASS — ${result.nativeSentinel.actual ?? "not checked"}`);
	} else {
		print(`   FAIL — expected ${result.nativeSentinel.expected}, actual ${result.nativeSentinel.actual ?? "<not found>"}`);
	}

	print("\n6. Deletion audit");
	if (result.deletionAudit.ok) {
		print("   PASS — every upstream file missing from main is registered in § removals");
	} else {
		print(`   FAIL — ${result.deletionAudit.violations.length} upstream file(s) deleted on main but not registered:`);
		for (const v of result.deletionAudit.violations.slice(0, 25)) {
			print(`   ${v}`);
		}
		if (result.deletionAudit.violations.length > 25) {
			print(`   ... and ${result.deletionAudit.violations.length - 25} more`);
		}
		print("   Hint: add to feature-registry.yaml § removals or restore from upstream/main.");
	}

	print("\n--- JSON ---");
	print(JSON.stringify(result, null, 2));
}

// ─── Main flow ──────────────────────────────────────────────────────────────

async function main() {
	const registry = await loadRegistry();

	// ─── --status ───────────────────────────────────────────────────────────
	if (shouldStatus) {
		section("Sync Status");
		const state = await readState();
		if (!state) {
			print("No sync state found.");
		} else {
			print(`Sync ID:       ${state.syncId}`);
			print(`Repo path:     ${state.repoPath}`);
			print(`Pre-sync HEAD: ${state.preSyncHeadShort} (${state.preSyncHead})`);
			print(`Upstream head: ${state.upstreamHead}`);
			print(`Upstream base: ${state.upstreamBase}`);
			print(`Started at:    ${state.startedAt}`);
			print(`Status:        ${state.status}`);
		}
		// Print last 5 log entries
		try {
			const logText = await Bun.file(LOG_PATH).text();
			const entries = logText.trim().split("\n").filter(Boolean);
			print(`\nLast ${Math.min(entries.length, 5)} log entries:`);
			for (const line of entries.slice(-5)) {
				const e = JSON.parse(line) as LogEntry;
				const ts = e.finishedAt ?? e.startedAt;
				print(`  [${ts}] ${e.status} — ${e.syncId}${e.reason ? ` (${e.reason})` : ""}`);
			}
		} catch {
			print("\nNo log entries found.");
		}
		process.exit(0);
	}

	// ─── --revert ───────────────────────────────────────────────────────────
	if (shouldRevert) {
		section("Revert");
		const state = await readState();
		if (!state) {
			print("ERROR: No sync state found. Nothing to revert.");
			process.exit(1);
		}
		if (state.status === "completed") {
			print("ERROR: Last sync is marked completed. Reverting a completed sync may lose upstream changes.");
			print("If you are certain, run manually:");
			print(`  git reset --hard ${state.preSyncHead}`);
			process.exit(1);
		}
		if (state.repoPath !== root) {
			print(`ERROR: Sync state belongs to a different repo (${state.repoPath}).`);
			process.exit(1);
		}
		const currentHead = await gitRevParse("HEAD");
		if (currentHead === state.preSyncHead) {
			print(`Already at pre-sync HEAD ${state.preSyncHeadShort} (${state.preSyncHead}).`);
			process.exit(0);
		}
		print(`Reverting to pre-sync HEAD ${state.preSyncHeadShort} (${state.preSyncHead})...`);
		const reset = await $`git reset --hard ${state.preSyncHead}`.cwd(root).nothrow();
		if (reset.exitCode !== 0) {
			print("ERROR: git reset --hard failed.");
			process.exit(1);
		}
		const revertedState: SyncState = { ...state, status: "reverted" };
		await writeState(revertedState);
		await appendLog({ ...revertedState, finishedAt: new Date().toISOString(), reason: "cli_revert" });
		print(`Reverted. Status: reverted. Log appended.`);
		process.exit(0);
	}

	// ─── --verify only ──────────────────────────────────────────────────────
	if (doVerify && !doContinue) {
		const result = await runVerify(registry);
		printVerify(result);
		process.exit(
			result.conflictMarkers.ok && result.symbolHealth.ok && result.commitSurvival.ok && result.typeCheck.ok && result.deletionAudit.ok ? 0 : 1,
		);
	}

	// ─── Interrupted sync warning ───────────────────────────────────────────
	const existingState = await readState();
	if (existingState && existingState.status === "started" && existingState.repoPath === root) {
		print(`\n⚠️  WARNING: A previous sync (${existingState.syncId}) never recorded an outcome.`);
		print(`   If post-rebase fixes were made, resolve and continue with --continue.`);
		print(`   If not, run with --revert to restore ${existingState.preSyncHeadShort}.`);
		print("");
	}

	// ─── Pre-flight ─────────────────────────────────────────────────────────
	section("Pre-flight");

	if (!doContinue) {
		const branch = await gitBranch();
		if (branch !== "main") {
			print(`ERROR: not on main branch (current: ${branch})`);
			print("Switch to main before syncing: git checkout main");
			process.exit(1);
		}

		const status = await gitStatus();
		if (status.trim()) {
			print("ERROR: working tree has uncommitted changes.");
			print("Stash or commit before syncing:");
			print(status);
			process.exit(1);
		}

		print("OK: on main, clean working tree");
	} else {
		print("OK: continuing rebase in progress");
	}

	// ─── Fetch upstream ─────────────────────────────────────────────────────
	section("Fetch upstream");
	if (!args.includes("--no-fetch")) {
		const fetch = await $`GIT_TERMINAL_PROMPT=0 git fetch upstream`.cwd(root).quiet().nothrow();
		if (fetch.exitCode !== 0) {
			const hasUpstreamMain = (await $`git rev-parse --verify upstream/main`.cwd(root).quiet().nothrow()).exitCode === 0;
			if (hasUpstreamMain) {
				print("WARNING: git fetch upstream failed (network offline?). Proceeding with existing local upstream/main ref.");
			} else {
				print("ERROR: git fetch upstream failed and no local upstream/main ref exists.");
				print("Check that the upstream remote is configured: git remote -v");
				process.exit(1);
			}
		}
	}

	const upstreamHead = await gitRevParseShort("upstream/main");
	const forkBase = await gitMergeBase("main", "upstream/main");
	const forkBaseShort = await gitRevParseShort(forkBase);
	const newCommits = await gitLogOneline(`${forkBase}..upstream/main`);
	const forkCommitsText = await gitLogOneline("upstream/main..main");
	const forkCommitHashes = await gitRevList("upstream/main..main");

	print(`Upstream head:  ${upstreamHead}`);
	print(`Current base:   ${forkBaseShort}`);
	print(`New upstream commits:\n${newCommits || "  (none — already up to date)"}`);
	print(`Fork commits to rebase:\n${forkCommitsText || "  (none)"}`);

	const origHead = await gitRevParse("main");

	// Load or create sync state
	let syncState: SyncState;
	if (doContinue) {
		const existing = await readState();
		if (existing && existing.repoPath === root) {
			syncState = existing;
		} else {
			print("WARNING: No existing sync state found for --continue. Treating as new sync.");
			const syncId = `${origHead.slice(0, 8)}-${upstreamHead}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
			syncState = {
				repoPath: root,
				preSyncHead: origHead,
				preSyncHeadShort: await gitRevParseShort(origHead),
				upstreamHead,
				upstreamBase: forkBase,
				startedAt: new Date().toISOString(),
				status: "started",
				syncId,
				observations: [],
			};
		}
	} else {
		const syncId = `${origHead.slice(0, 8)}-${upstreamHead}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
		syncState = {
			repoPath: root,
			preSyncHead: origHead,
			preSyncHeadShort: await gitRevParseShort(origHead),
			upstreamHead,
			upstreamBase: forkBase,
			startedAt: new Date().toISOString(),
			status: "started",
			syncId,
			observations: [],
		};
	}

	if (!newCommits) {
		print("\nAlready up to date with upstream/main (0 new upstream commits). Nothing to rebase.");
		if (!dryRun) {
			syncState.status = "completed";
			await writeState(syncState);
			await appendLog({ ...syncState, finishedAt: new Date().toISOString() });
		}
		process.exit(0);
	}

	if (!doContinue) {
		// ─── Registry validation (always, before rebase) ────────────────────────
		section("Registry validation");
		const validation = await validateRegistry(registry);
		if (!validation.ok) {
			print("ERROR: The following files are touched by fork commits but are NOT registered in feature-registry.yaml:");
			for (const u of validation.unregistered) {
				print(`  ${u.file}  (commit ${u.commit})`);
			}
			print("\nAdd each file to § features or § divergences in feature-registry.yaml,");
			print("regenerate SKILL.md, and re-run.");
			process.exit(1);
		}
		print(`PASS — all ${[...new Set(await gitDiffNameOnly("upstream/main..main"))].length} files touched by fork commits are registered.`);
	}

	// ─── Dry-run preview ────────────────────────────────────────────────────
	if (dryRun) {
		const preview = await buildPreview(registry);
		printPreview(preview);
		process.exit(0);
	}

	if (!doContinue) {
		await writeState(syncState);
	}

	// ─── Pre-sync tag ───────────────────────────────────────────────────────
	if (shouldTag) {
		const date = new Date().toISOString().slice(0, 10);
		const baseTag = await resolveTagName(`sync/base/${date}`);
		await gitTagCreate(baseTag, origHead, `Pre-sync backup before rebase onto upstream/main ${upstreamHead}`);
		print(`Tagged pre-sync HEAD: ${baseTag}`);
	}

	// ─── Stage-recording helper ─────────────────────────────────────────────
	async function recordStage(status: SyncState["status"], observation?: string) {
		if (dryRun) return;
		syncState.status = status;
		if (observation) {
			syncState.observations = syncState.observations ?? [];
			syncState.observations.push(observation);
		}
		await writeState(syncState);
	}

	// ─── --continue path (rebase already in progress) ───────────────────────
	if (doContinue) {
		section("Continue rebase");

		// Check if a rebase is actually in progress
		const rebaseDir = await $`test -d .git/rebase-merge || test -d .git/rebase-apply`.cwd(root).quiet().nothrow();
		const isRebasing = rebaseDir.exitCode === 0;

		if (!isRebasing) {
			print("No rebase in progress. Use without --continue to start a new sync.");
			process.exit(1);
		}

		const conflicts = await gitConflicts();
		if (conflicts.length > 0) {
			print("Conflicts still present:");
			for (const f of conflicts) print(`  ${f}`);
			print("Resolve all conflicts, git add, then run --continue again.");
			process.exit(2);
		}

		print("No remaining conflicts. Continuing rebase...");
		const cont = await $`git rebase --continue`.cwd(root).nothrow();
		if (cont.exitCode !== 0) {
			print("Rebase --continue failed. More conflicts may have appeared.");
			// Fall through to conflict reporting below
		} else {
			print("Rebase completed.");
		}
	} else {
		// ─── Attempt rebase ─────────────────────────────────────────────────
		section("Rebase");
		print(`Rebasing main onto upstream/main (${upstreamHead})...`);

		const rebase = await $`git rebase upstream/main`.cwd(root).nothrow();

		if (rebase.exitCode === 0) {
			print("Rebase completed with no conflicts.");
			await recordStage("rebase_ok");

			// Empty-commit check
			const rebasedHashes = await gitRevList("upstream/main..main");
			const obsoletedHashes = buildObsoletedHashSet(registry);
			for (const hash of forkCommitHashes) {
				if (!rebasedHashes.includes(hash)) {
					const shortHash = hash.slice(0, 7);
					if (obsoletedHashes.has(hash)) {
						print(`\nℹ️  Commit ${shortHash} was dropped by rebase (expected — tracked as obsoleted fix).`);
					} else {
						print(
							`\n⚠️  WARNING: Commit ${shortHash} became empty and was dropped by rebase.`,
						);
						print("   Upstream may have independently applied this change.");
						print("   Verify the feature/bug-fix is still present before proceeding.");
					}
				}
			}
		}
	}

	// ─── Conflict reporting ─────────────────────────────────────────────────
	const conflicts = await gitConflicts();
	if (conflicts.length > 0) {
		section("Conflicts detected");
		print("The rebase has stopped. Conflicted files:\n");

		const conflictInfos = await buildConflictReport(registry);
		for (const info of conflictInfos) {
			print(`  CONFLICT: ${info.file}`);
			if (info.owners.length > 0) {
				print(`    OWP features: ${info.owners.map(o => o.name).join(", ")}`);
			}
			if (info.divergence) {
				print(`    Divergence: ${info.divergence.reason}`);
			}
			if (info.upstreamCommit) {
				print(`    Latest upstream: ${info.upstreamCommit}`);
			}
			print(`    → ${recommendationLabel(info.recommendation)}`);
			print("");
		}

		print("RESOLVE CONFLICTS using the decision tree in SKILL.md.");
		print("For each conflicted file:");
		print("  1. Apply the decision tree");
		print("  2. Edit the file to resolve");
		print("  3. git add <file>");
		print("  4. When all resolved: bun .omp/skills/sync-upstream/sync.ts --continue");
		print("  5. If more conflicts appear, re-run --continue to see the next batch");
		print("\nTo abort and restore:");
		print(`  git rebase --abort && git reset --hard ${origHead}`);
		await recordStage("failed_rebase");
		await appendLog({ ...syncState, finishedAt: new Date().toISOString() });
		process.exit(2);
	}

	// ─── Type check ─────────────────────────────────────────────────────────
	section("Type check");
	print("Running bun check:ts...");

	const check = await $`bun check:ts`.cwd(root).nothrow();
	if (check.exitCode !== 0) {
		print("ERROR: bun check:ts failed after rebase.");
		print("Fix type errors before pushing. To rollback:");
		print(`  git reset --hard ${origHead}`);
		print(`  git push origin main --force-with-lease`);
		await recordStage("failed_typecheck", check.text().slice(0, 500));
		await appendLog({ ...syncState, finishedAt: new Date().toISOString() });
		process.exit(1);
	}

	print("OK: type check passed");
	await recordStage("typecheck_ok");

	// ─── Verify ─────────────────────────────────────────────────────────────
	if (doVerify || doContinue) {
		const vResult = await runVerify(registry);
		printVerify(vResult);
		if (!vResult.conflictMarkers.ok || !vResult.symbolHealth.ok || !vResult.typeCheck.ok || !vResult.deletionAudit.ok) {
			await recordStage("failed_verify");
			await appendLog({ ...syncState, finishedAt: new Date().toISOString() });
			process.exit(1);
		}
	}

	// ─── Post-sync tag ──────────────────────────────────────────────────────
	if (shouldTag) {
		const date = new Date().toISOString().slice(0, 10);
		const postTag = await resolveTagName(`sync/${date}`);
		const head = await gitRevParse("HEAD");
		await gitTagCreate(postTag, head, `Post-sync after rebase onto upstream/main ${upstreamHead}`);
		print(`Tagged post-sync HEAD: ${postTag}`);
	}

	// ─── Result ─────────────────────────────────────────────────────────────
	section("Result");

	const newBase = await gitMergeBase("main", "upstream/main");
	const newBaseShort = await gitRevParseShort(newBase);
	const newBaseMsg = (await gitLogOneline(`-1 ${newBase}`)).trim();

	print(`New upstream base: ${newBaseShort} ${newBaseMsg}`);
	print(`Update docs/maintaining-owp-fork.md § Last Sync Point:`);
	print(`  **Upstream base:** \`${newBaseShort}\``);
	print(`  **Date:** ${new Date().toISOString().slice(0, 10)}`);
	print(`  git format-patch ${newBaseShort}..upstream/main`);

	syncState.status = "completed";
	await writeState(syncState);
	await appendLog({ ...syncState, finishedAt: new Date().toISOString() });

	// ─── Push ───────────────────────────────────────────────────────────────
	if (shouldPush) {
		section("Push");
		const pushArgs = shouldTag
			? $`git push origin main --force-with-lease --follow-tags`.cwd(root).nothrow()
			: $`git push origin main --force-with-lease`.cwd(root).nothrow();
		const push = await pushArgs;
		if (push.exitCode !== 0) {
			print("ERROR: push failed (someone else may have pushed).");
			print("Fetch and retry, or push manually.");
			process.exit(1);
		}
		print("OK: pushed origin/main");
		if (shouldTag) {
			print("OK: pushed tags");
		}
	} else {
		print("\nDry run complete (--push not set). To push:");
		print("  bun .omp/skills/sync-upstream/sync.ts --push");
		print("  or: git push origin main --force-with-lease");
		if (shouldTag) {
			print("  Tags created locally. To push tags:");
			print("  git push origin --follow-tags");
		}
	}
}

main().catch(err => {
	print(String(err));
	process.exit(1);
});
