import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	FORK_DOC_PATH,
	REGISTRY,
	SHARED_FILES,
	SKILL_DOC,
	SRC_PATHS,
	UPSTREAM_RANGE,
} from "./owp-checklist.generated";

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async (_event, ctx) => {
		// Skip if more messages are queued — wait for the real end of the sequence.
		if (ctx.hasPendingMessages()) return;

		const reminders: string[] = [];

		// Reminder 1: Owned Symbols registry — fires on uncommitted changes to shared files
		// when the skill doc wasn't also touched this session.
		const diffResult = await pi.exec("git", ["diff", "--name-only", "HEAD"], { cwd: ctx.cwd });
		if (diffResult.code === 0) {
			const changedFiles = diffResult.stdout.trim().split("\n").filter(Boolean);
			const touchedShared = changedFiles.filter(f => SHARED_FILES.includes(f));
			const touchedSkillDoc = changedFiles.includes(SKILL_DOC);
			if (touchedShared.length > 0 && !touchedSkillDoc) {
				reminders.push(
					`**Owned Symbols registry out of date.** These shared files were modified:\n` +
						touchedShared.map(f => `- \`${f}\``).join("\n") +
						`\n\nUpdate \`${SKILL_DOC} § Owned Symbols\` with any new symbols added. ` +
						`If symbols were removed, delete their rows.`,
				);
			}
		}

		// Reminder 2: Fork Features table — fires when any committed src change is not
		// mentioned in the table. Checks committed state so it doesn't fire on
		// in-progress edits or when the table was already updated in a prior commit.
		const logResult = await pi.exec(
			"git",
			["log", "--format=%h", "-n", "20", UPSTREAM_RANGE, "--", ...SRC_PATHS],
			{ cwd: ctx.cwd },
		);
		if (logResult.code === 0) {
			const srcCommits = logResult.stdout.trim().split("\n").filter(Boolean);
			if (srcCommits.length > 0) {
				const catResult = await pi.exec("cat", [FORK_DOC_PATH], { cwd: ctx.cwd });
				const tableContent = catResult.code === 0 ? catResult.stdout : "";
				const undocumented = srcCommits.filter(hash => hash && !tableContent.includes(hash));
				if (undocumented.length > 0) {
					reminders.push(
						`**Fork Features table not updated.** The table in \`${FORK_DOC_PATH} § Fork Features\` ` +
							`is generated from git history; refresh it with: ` +
							"`forklift render`.",
					);
				}
			}
		}

		// Reminder 3: Registry completeness — fires when any committed src change
		// modifies a file not covered by .forklift/registry.yaml § features or § divergences.
		const logAllResult = await pi.exec("git", ["log", "--format=%h", UPSTREAM_RANGE, "--name-only"], { cwd: ctx.cwd });
		if (logAllResult.code === 0) {
			const lines = logAllResult.stdout.trim().split("\n");
			// Build set of files touched by any fork commit from this session
			const filesTouched = new Set<string>();
			for (const line of lines) {
				if (line.trim() && !/^[0-9a-f]{7,40}$/.test(line.trim())) {
					filesTouched.add(line.trim());
				}
			}
			if (filesTouched.size > 0) {
				// Load registry patterns
				const registryResult = await pi.exec("cat", [REGISTRY], { cwd: ctx.cwd });
				if (registryResult.code === 0) {
					const registryText = registryResult.stdout;
					// Collect all owned_paths and divergence paths from YAML (simple line-based)
					const registeredPatterns: string[] = [];
					for (const line of registryText.split("\n")) {
						const trimmed = line.trim();
						if (trimmed.startsWith("-") && trimmed.includes('"')) {
							const m = trimmed.match(/"([^"]+)"/);
							if (m) registeredPatterns.push(m[1]);
						}
						if (trimmed.startsWith("path:")) {
							const m = trimmed.match(/"([^"]+)"/);
							if (m) registeredPatterns.push(m[1]);
						}
					}
					function isRegistered(file: string): boolean {
						for (const pat of registeredPatterns) {
							if (pat === file) return true;
							if (pat.endsWith("/") && file.startsWith(pat)) return true;
							if (pat.includes("*")) {
								const regex = new RegExp(
									"^" +
										pat
											.replace(/\*\*/g, "<<<DS>>>")
											.replace(/\*/g, "[^/]*")
											.replace(/<<<DS>>>/g, ".*") +
										"$",
								);
								if (regex.test(file)) return true;
							}
						}
						return false;
					}
					const unregistered = [...filesTouched].filter(f => !isRegistered(f));
					if (unregistered.length > 0) {
						const SHOW = 20;
						const shown = unregistered.slice(0, SHOW);
						const more = unregistered.length - SHOW;
						let msg =
							`**Feature registry incomplete.** ${unregistered.length} file(s) touched by fork commits ` +
							`are not listed in \`${REGISTRY}\`:\n` +
							shown.map(f => `- \`${f}\``).join("\n");
						if (more > 0) msg += `\n- *… and ${more} more*`;
						msg +=
							`\n\nAdd them to § features or § divergences, then regenerate SKILL.md with ` +
							`\`forklift render\`.`;
						reminders.push(msg);
					}
				}
			}
		}

		if (reminders.length === 0) return;

		pi.sendMessage(
			{
				customType: "owp-feature-checklist",
				content: `## OWP Feature Checklist\n\n` + reminders.join("\n\n"),
				display: true,
				attribution: "agent",
			},
			{ triggerTurn: false },
		);
	});
}
