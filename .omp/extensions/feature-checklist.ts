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
const SRC_PREFIX = "packages/coding-agent/src/";

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async (_event, ctx) => {
		// Skip if more messages are queued — wait for the real end of the sequence.
		if (ctx.hasPendingMessages()) return;

		// Check unstaged + staged changes relative to HEAD.
		// This covers mid-implementation state where edits exist but aren't committed yet.
		const result = await pi.exec("git", ["diff", "--name-only", "HEAD"], { cwd: ctx.cwd });
		if (result.code !== 0) return;

		const changedFiles = result.stdout.trim().split("\n").filter(Boolean);
		if (changedFiles.length === 0) return;

		// Only act when coding-agent or ai package source was touched — skip docs-only, chore, sync commits.
		const touchedSrc = changedFiles.some(f => f.startsWith(SRC_PREFIX) || f.startsWith("packages/ai/src/"));
		if (!touchedSrc) return;

		const reminders: string[] = [];

		// Reminder 1: shared files whose symbol registry must stay current.
		// Suppressed if SKILL_DOC was also modified — the registry was already updated this session.
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

		// Reminder 2: Fork Features table must reflect every feature commit.
		// Check applies to any coding-agent source change, not just shared-file changes.
		const touchedForkDoc = changedFiles.includes(FORK_FEATURES_DOC);
		if (!touchedForkDoc) {
			reminders.push(
				`**Fork Features table not updated.** \`${FORK_FEATURES_DOC} § Fork Features\` ` +
					`must reflect every feature commit. Run \`git log --oneline upstream/main..HEAD\` ` +
					`and ensure the table matches.`,
			);
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
