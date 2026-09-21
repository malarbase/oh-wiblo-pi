#!/usr/bin/env bun
/**
 * generate-skill-md.ts — Generate SKILL.md from feature-registry.yaml + template,
 * and the Fork Features table in docs/maintaining-owp-fork.md from git history.
 *
 * Usage:
 *   bun .omp/skills/sync-upstream/generate-skill-md.ts
 *   bun .omp/skills/sync-upstream/generate-skill-md.ts --check
 *
 * --check diffs the generated output against the current files and exits
 * non-zero if they differ (CI gate).
 */

import * as path from "node:path";
import { $ } from "bun";

const SKILL_MD = path.resolve(import.meta.dir, "SKILL.md");
const REGISTRY = path.resolve(import.meta.dir, "feature-registry.yaml");
const TEMPLATE = path.resolve(import.meta.dir, "SKILL.md.template");
const ROOT = path.resolve(import.meta.dir, "../../..");
const FORK_DOC = path.resolve(ROOT, "docs", "maintaining-owp-fork.md");
const FORK_COMMITS_START = "<!-- GENERATED:fork-commits:start -->";
const FORK_COMMITS_END = "<!-- GENERATED:fork-commits:end -->";


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

interface ForkCommit {
	hash: string;
	subject: string;
	files: string[];
}

async function loadRegistry(): Promise<Registry> {
	const text = await Bun.file(REGISTRY).text();
	return Bun.YAML.parse(text) as Registry;
}

async function loadTemplate(): Promise<string> {
	return Bun.file(TEMPLATE).text();
}

function generateFeatureStack(features: Feature[]): string {
	const rows = features
		.map(
			f =>
				`| ${f.name} | ${f.owned_paths.map(p => `\`${p}\``).join(", ")} |`,
		)
		.join("\n");

	return `## Feature Stack

These are owp-owned files. Conflicts here prefer ours unless upstream's change is semantic.

| Feature | Owned files |
|---------|------------|
${rows}

> **Note:** The § Owned Symbols table below is generally more current than this § Feature Stack, because new shared-file symbols are registered immediately while high-level feature rows may lag. After any feature merge, audit both tables.`;
}

function generateOwnedSymbols(groups: OwnedSymbolGroup[]): string {
	const sections = groups.map(g => {
		const rows = g.symbols
			.map(
				s =>
					`| ${s.name} | ${s.location ?? "—"} | ${s.description} |`,
			)
			.join("\n");

		return `### ${path.basename(g.file)} (${g.file})

| Feature | Symbol | Location | Description |
|---------|--------|----------|-------------|
${rows}`;
	});

	return `## Owned Symbols in Shared Files

When a conflict occurs in a file shared with upstream, the Feature Stack tells you "prefer ours"
but doesn't tell you *which lines are ours*. This section lists the exact symbols each feature
owns inside shared files.

${sections.join("\n\n")}`;
}

function generateDivergences(divergences: Divergence[]): string {
	const items = divergences
		.map(d => `- \`${d.path}\` — ${d.reason}`)
		.join("\n");

	return `## Upstream Divergences (take upstream)

These omp files exist but owp intentionally doesn't override them. Always take upstream:

${items}

> **WARNING:** The divergence list exists because these files are considered upstream-owned. If you add an owp feature that modifies one of these files, the feature will be silently lost on the next sync (the decision tree will "prefer upstream"). You must either:
> 1. Move the feature out of these files, or
> 2. Add the file to the Feature Stack registry and change the divergence list entry to note the dual ownership.`;
}

function generateRemovals(removals: { path: string; reason: string }[]): string {
	const intro = `## Intentional Removals (deleted vs upstream)

These upstream paths are intentionally absent from owp. \`sync.ts --verify\` fails if any other upstream file goes missing.`;

	if (removals.length === 0) {
		return `${intro}

None registered.`;
	}

	const items = removals
		.map(r => `- \`${r.path}\` — ${r.reason}`)
		.join("\n");

	return `${intro}

${items}`;
}

function generateObsoletedFixes(features: Feature[]): string {
	const featuresWithFixes = features.filter(f => f.obsoleted_fixes && f.obsoleted_fixes.length > 0);
	if (featuresWithFixes.length === 0) {
		return `## Obsoleted Fixes

No upstream-obsoleted fixes are currently tracked.`;
	}

	const sections = featuresWithFixes.map(f => {
		const rows = f.obsoleted_fixes!
			.map(fix => `| \`${fix.pre_rebase_hash}\` | ${fix.description} | \`${fix.upstream_obsoleted_in}\` |`)
			.join("\n");

		return `### ${f.name}

| Pre-rebase hash | Description | Upstream obsoleted in |
|-----------------|-------------|-----------------------|
${rows}`;
	});

	return `## Obsoleted Fixes

These commits were previously part of the fork but became empty during rebase because upstream independently applied the same fix (or made it unnecessary). They are tracked here so sync.ts can suppress false-positive dropped-commit warnings.

${sections.join("\n\n")}`;
}

// ─── Fork-commits table (generated from git history) ────────────────────────

async function collectForkCommits(): Promise<ForkCommit[]> {
	const fmt = "%h|%s";
	const log = await $`git log --reverse --name-only --format=${fmt} upstream/main..main`
		.cwd(ROOT)
		.quiet()
		.text();
	const commits: ForkCommit[] = [];
	for (const rawLine of log.split("\n")) {
		const line = rawLine.trimEnd();
		if (!line.trim()) continue;
		const sep = line.indexOf("|");
		if (sep > 0 && /^[0-9a-f]{7,12}$/.test(line.slice(0, sep))) {
			commits.push({ hash: line.slice(0, sep), subject: line.slice(sep + 1), files: [] });
		} else if (commits.length > 0) {
			commits[commits.length - 1].files.push(line);
		}
	}
	return commits;
}

// Markdown table cells must escape pipes and backticks; subject and file columns
// share this rule, so it lives here rather than being inlined twice.
function escapeCell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/`/g, "'");
}

function statusFor(commit: ForkCommit): string {
	const s = commit.subject.toLowerCase();
	if (s.startsWith("wip:") || s.startsWith("wip ")) return "rebase recovery";
	if (s.startsWith("build")) return "build";
	if (s.startsWith("chore")) return "chore";
	const docFiles =
		commit.files.length > 0 &&
		commit.files.every(f => /\.(md|txt|ya?ml)$/.test(f));
	if (docFiles) return "docs only";
	if (/^docs[:(]/.test(s)) return "mixed";
	return "code";
}

function formatFiles(files: string[]): string {
	const MAX = 5;
	if (files.length === 0) return "—";
	const shown = files.slice(0, MAX).map(f => `\`${escapeCell(f)}\``);
	if (files.length > MAX) shown.push(`… (${files.length - MAX} more)`);
	return shown.join(", ");
}

function generateForkCommitsTable(commits: ForkCommit[]): string {
	const rows = commits
		.map(
			c =>
				`| \`${c.hash}\` | ${escapeCell(c.subject)} | ${formatFiles(c.files)} | ${statusFor(c)} |`,
		)
		.join("\n");

	return `Total: ${commits.length} fork commits on top of \`upstream/main\`.

| Commit | Feature | Owned Files | Status |
|--------|---------|------------|--------|
${rows}

> **Note:** Generated from \`git log upstream/main..main\`. Commit hashes change on every rebase — refresh this table by running \`bun .omp/skills/sync-upstream/generate-skill-md.ts\`, never by hand.`;
}

async function generateSkillMd(): Promise<string> {
	const registry = await loadRegistry();
	const template = await loadTemplate();

	return template
		.replace("<!-- GENERATED:feature-stack -->", generateFeatureStack(registry.features))
		.replace(
			"<!-- GENERATED:owned-symbols -->",
			generateOwnedSymbols(registry.owned_symbols),
		)
		.replace(
			"<!-- GENERATED:divergences -->",
			generateDivergences(registry.divergences),
		)
		.replace(
			"<!-- GENERATED:obsoleted-fixes -->",
			generateObsoletedFixes(registry.features),
		)
		.replace(
			"<!-- GENERATED:removals -->",
			generateRemovals(registry.removals ?? []),
		);
}

async function generateUpdatedForkDoc(): Promise<string> {
	const forkDoc = await Bun.file(FORK_DOC).text();
	const startIdx = forkDoc.indexOf(FORK_COMMITS_START);
	const endIdx = forkDoc.indexOf(FORK_COMMITS_END);
	if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
		throw new Error(`Sentinels ${FORK_COMMITS_START}..${FORK_COMMITS_END} not found in ${FORK_DOC}`);
	}
	const commits = await collectForkCommits();
	return (
		forkDoc.slice(0, startIdx + FORK_COMMITS_START.length) +
		"\n" +
		generateForkCommitsTable(commits) +
		"\n" +
		forkDoc.slice(endIdx)
	);
}

async function main() {
	const args = process.argv.slice(2);
	const checkMode = args.includes("--check");
	const updatedForkDoc = await generateUpdatedForkDoc();

	if (checkMode) {
		const generated = await generateSkillMd();
		const current = await Bun.file(SKILL_MD).text();
		let ok = true;
		if (generated !== current) {
			console.error("ERROR: SKILL.md is out of date with feature-registry.yaml.");
			console.error("Run: bun .omp/skills/sync-upstream/generate-skill-md.ts");
			ok = false;
		}
		const currentForkDoc = await Bun.file(FORK_DOC).text();
		if (updatedForkDoc !== currentForkDoc) {
			console.error("ERROR: Fork Features table in docs/maintaining-owp-fork.md is out of date with git history.");
			console.error("Run: bun .omp/skills/sync-upstream/generate-skill-md.ts");
			ok = false;
		}
		if (!ok) process.exit(1);
		console.error("OK: SKILL.md and Fork Features table are up to date.");
		process.exit(0);
	}

	const output = await generateSkillMd();
	await Bun.write(SKILL_MD, output);
	console.error(`Wrote ${SKILL_MD}`);
	await Bun.write(FORK_DOC, updatedForkDoc);
	console.error(`Wrote ${FORK_DOC}`);
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
