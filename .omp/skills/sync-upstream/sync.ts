#!/usr/bin/env bun
/**
 * sync.ts — Rebase owp fork/main against omp upstream/main.
 *
 * Runs the mechanical git steps and emits structured output.
 * The agent reads this output and resolves conflicts using
 * the decision tree in SKILL.md.
 *
 * Usage:
 *   bun .omp/skills/sync-upstream/sync.ts [--check] [--push]
 *
 *   --check   Fetch + rebase only, no push (default)
 *   --push    Push origin main after successful rebase
 */

import * as path from "node:path";
import { $ } from "bun";

const args = process.argv.slice(2);
const shouldPush = args.includes("--push");
const root = path.resolve(import.meta.dir, "../../..");

function print(msg: string) {
	process.stdout.write(msg + "\n");
}

function section(title: string) {
	print(`\n=== ${title} ===`);
}

async function run(cmd: TemplateStringsArray, ...vals: unknown[]) {
	return $`${cmd}`.cwd(root).quiet().nothrow();
}

// ─── 1. Verify we are on main ───────────────────────────────────────────────

section("Pre-flight");

const branch = await $`git branch --show-current`.cwd(root).quiet().text();
if (branch.trim() !== "main") {
	print(`ERROR: not on main branch (current: ${branch.trim()})`);
	print("Switch to main before syncing: git checkout main");
	process.exit(1);
}

const status = await $`git status --porcelain`.cwd(root).quiet().text();
if (status.trim()) {
	print("ERROR: working tree has uncommitted changes.");
	print("Stash or commit before syncing:");
	print(status);
	process.exit(1);
}

print("OK: on main, clean working tree");

// ─── 2. Fetch upstream ──────────────────────────────────────────────────────

section("Fetch upstream");

const fetch = await $`git fetch upstream`.cwd(root).quiet().nothrow();
if (fetch.exitCode !== 0) {
	print("ERROR: git fetch upstream failed.");
	print("Check that the upstream remote is configured: git remote -v");
	process.exit(1);
}

const upstreamHead = (await $`git rev-parse --short upstream/main`.cwd(root).quiet().text()).trim();
const forkBase = (await $`git merge-base main upstream/main`.cwd(root).quiet().text()).trim();
const forkBaseShort = (await $`git rev-parse --short ${forkBase}`.cwd(root).quiet().text()).trim();
const newCommits = (
	await $`git log --oneline ${forkBase}..upstream/main`.cwd(root).quiet().text()
).trim();
const forkCommits = (
	await $`git log --oneline upstream/main..main`.cwd(root).quiet().text()
).trim();

print(`Upstream head:  ${upstreamHead}`);
print(`Current base:   ${forkBaseShort}`);
print(`New upstream commits:\n${newCommits || "  (none — already up to date)"}`);
print(`Fork commits to rebase:\n${forkCommits || "  (none)"}`);

if (!newCommits) {
	print("\nAlready up to date. Nothing to do.");
	process.exit(0);
}

// ─── 3. Save ORIG_HEAD for rollback ─────────────────────────────────────────

const origHead = (await $`git rev-parse main`.cwd(root).quiet().text()).trim();

// ─── 4. Attempt rebase ──────────────────────────────────────────────────────

section("Rebase");
print(`Rebasing main onto upstream/main (${upstreamHead})...`);

const rebase = await $`git rebase upstream/main`.cwd(root).nothrow();

if (rebase.exitCode === 0) {
	print("Rebase completed with no conflicts.");
} else {
	// Rebase stopped — report conflicted files for the agent to resolve
	section("Conflicts detected");

	const conflicts = (
		await $`git diff --name-only --diff-filter=U`.cwd(root).quiet().text()
	).trim();

	if (!conflicts) {
		print("Rebase stopped but no conflict markers found — may be a merge commit.");
		print("Run: git rebase --skip   (to skip merge-only commits)");
		print("Then re-run this script to continue.");
		process.exit(2);
	}

	print("The rebase has stopped. Conflicted files:\n");
	for (const file of conflicts.split("\n").filter(Boolean)) {
		print(`  CONFLICT: ${file}`);
	}

	print("\nRESOLVE CONFLICTS using the decision tree in SKILL.md.");
	print("For each conflicted file:");
	print("  1. Apply the decision tree");
	print("  2. Edit the file to resolve");
	print("  3. git add <file>");
	print("  4. When all resolved: git rebase --continue");
	print("  5. If more conflicts appear, re-run this script to see the next batch");
	print("\nTo abort and restore:");
	print(`  git rebase --abort && git reset --hard ${origHead}`);
	process.exit(2);
}

// ─── 5. Verify compilation ──────────────────────────────────────────────────

section("Type check");
print("Running bun check:ts...");

const check = await $`bun check:ts`.cwd(root).nothrow();
if (check.exitCode !== 0) {
	print("ERROR: bun check:ts failed after rebase.");
	print("Fix type errors before pushing. To rollback:");
	print(`  git reset --hard ${origHead}`);
	print(`  git push origin main --force-with-lease`);
	process.exit(1);
}

print("OK: type check passed");

// ─── 6. Report new upstream base ────────────────────────────────────────────

section("Result");

const newBase = (await $`git merge-base main upstream/main`.cwd(root).quiet().text()).trim();
const newBaseShort = (await $`git rev-parse --short ${newBase}`.cwd(root).quiet().text()).trim();
const newBaseMsg = (
	await $`git log --oneline -1 ${newBase}`.cwd(root).quiet().text()
).trim();

print(`New upstream base: ${newBaseShort} ${newBaseMsg}`);
print(`Update docs/maintaining-owp-fork.md § Last Sync Point:`);
print(`  **Upstream base:** \`${newBaseShort}\``);
print(`  **Date:** ${new Date().toISOString().slice(0, 10)}`);
print(`  git format-patch ${newBaseShort}..upstream/main`);

// ─── 7. Push ────────────────────────────────────────────────────────────────

if (shouldPush) {
	section("Push");
	const push = await $`git push origin main --force-with-lease`.cwd(root).nothrow();
	if (push.exitCode !== 0) {
		print("ERROR: push failed (someone else may have pushed).");
		print("Fetch and retry, or push manually.");
		process.exit(1);
	}
	print("OK: pushed origin/main");
} else {
	print("\nDry run complete (--push not set). To push:");
	print("  bun .omp/skills/sync-upstream/sync.ts --push");
	print("  or: git push origin main --force-with-lease");
}
