import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

// Shared files where OWP adds symbols inside upstream-owned structure.
// Touching any of these warrants updating the Owned Symbols registry.
const SHARED_FILES = [
	"packages/coding-agent/src/sdk.ts",
	"packages/coding-agent/src/config/model-registry.ts",
	"packages/coding-agent/src/config/settings-schema.ts",
	"packages/coding-agent/src/modes/components/status-line/presets.ts",
	"packages/coding-agent/src/modes/components/status-line/segments.ts",
	"packages/coding-agent/src/modes/components/status-line-segment-editor.ts",
	"packages/ai/src/types.ts",
	"packages/ai/src/providers/anthropic.ts",
];

const FORK_FEATURES_DOC = "docs/maintaining-owp-fork.md";
const SKILL_DOC = ".omp/skills/sync-upstream/SKILL.md";
const SRC_PATHS = ["packages/coding-agent/src/", "packages/ai/src/"];

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
			["log", "--format=%h", "upstream/main..HEAD", "--", ...SRC_PATHS],
			{ cwd: ctx.cwd },
		);
		if (logResult.code === 0) {
			const srcCommits = logResult.stdout.trim().split("\n").filter(Boolean);
			if (srcCommits.length > 0) {
				const catResult = await pi.exec("cat", [FORK_FEATURES_DOC], { cwd: ctx.cwd });
				const tableContent = catResult.code === 0 ? catResult.stdout : "";
				const undocumented = srcCommits.filter(hash => hash && !tableContent.includes(hash));
				if (undocumented.length > 0) {
					reminders.push(
						`**Fork Features table not updated.** \`${FORK_FEATURES_DOC} § Fork Features\` ` +
							`must reflect every feature commit. Run \`git log --oneline upstream/main..HEAD\` ` +
							`and ensure the table matches.`,
					);
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
