/**
 * Settings declared by this domain (see `config/registry.ts`). Declaration order is the
 * settings-panel order; `config/all-settings.ts` registers every domain.
 */
import { register } from "../config/registry";

// ────────────────────────────────────────────────────────────────────────
// Tasks
// ────────────────────────────────────────────────────────────────────────

// Plan mode
export const cfgPlanEnabled = register({
	id: "plan.enabled",
	type: "boolean",
	default: true,
	ui: {
		tab: "tasks",
		group: "Modes",
		label: "Plan Mode",
		description: "Enable plan mode for read-only exploration and planning before execution",
	},
});

export const cfgPlanDefaultOnStartup = register({
	id: "plan.defaultOnStartup",
	type: "boolean",
	default: false,
	ui: {
		tab: "tasks",
		group: "Modes",
		label: "Start in Plan Mode",
		description: "Automatically enter plan mode at the start of every new session",
		condition: "planModeEnabled",
	},
});

export const cfgPlanStorage = register({
	id: "plan.storage",
	type: "enum",
	values: ["session", "project"] as const,
	default: "session",
	ui: {
		tab: "tasks",
		group: "Modes",
		label: "Plan Storage Location",
		description:
			"Where approved plans are saved. 'session' stores in session artifacts directory (local://), 'project' saves to .omp/plans/ in project root.",
		options: [
			{
				value: "session",
				label: "Session Artifacts",
				description: "Default — stored in session artifacts (local://)",
			},
			{ value: "project", label: "Project Directory", description: "Saved to .omp/plans/ in workspace" },
		],
	},
});

export const cfgPlanAutosave = register({
	id: "plan.autosave",
	type: "boolean",
	default: false,
	ui: {
		tab: "tasks",
		group: "Modes",
		label: "Autosave Plans",
		description: "Automatically save approved plans to disk when plan mode completes",
		condition: "planModeEnabled",
	},
});

export const cfgPlanAutosaveDir = register({
	id: "plan.autosaveDir",
	type: "string",
	default: undefined,
	ui: {
		tab: "tasks",
		group: "Modes",
		label: "Autosave Directory",
		description:
			"Directory for autosaved plans. Supports ~, absolute, and cwd-relative paths. Empty uses <project>/.omp/plans/.",
		condition: "planAutosaveEnabled",
	},
});
