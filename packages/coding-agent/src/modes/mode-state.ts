/**
 * The session's mode, as a value derived from live harness state.
 *
 * The mode is deliberately *not* a cached field. A cached mode goes stale the
 * moment a mode changes through a path that does not run the switch routine —
 * a plan approval, `/plan`, `/plan load`, a session restore — and a stale mode
 * makes `switch_mode` claim the harness is somewhere it is not ("Already in
 * plan mode" while the harness is in agent mode). Deriving the mode from the
 * flags that drive the status line, the tool set and the system prompt keeps
 * one source of truth.
 */

/** The mode the harness is in. `"none"` is agent mode. */
export type SessionMode = "none" | "ask" | "plan" | "debug" | "goal";

/** The mode name as the model sees it. */
export const MODE_LABELS: Record<SessionMode, string> = {
	none: "agent",
	ask: "ask",
	plan: "plan",
	debug: "debug",
	goal: "goal",
};

/** The mode names a caller may request, mapped to the internal mode. */
export const MODE_FROM_NAME: Record<string, SessionMode> = {
	agent: "none",
	ask: "ask",
	plan: "plan",
	debug: "debug",
	goal: "goal",
};

export interface ModeSnapshot {
	/** The mode the harness is in. */
	mode: SessionMode;
	/** A paused plan is still a plan session, just suspended. */
	planPaused: boolean;
	/** A paused goal is still a goal session, just suspended. */
	goalPaused: boolean;
}

/** The live flags the mode is derived from. */
export interface ModeFlags {
	askModeEnabled: boolean;
	debugModeEnabled: boolean;
	planModeEnabled: boolean;
	planModePaused: boolean;
	goalModeEnabled: boolean;
	goalModePaused: boolean;
}

/**
 * Derive the mode from the flags that drive the status line, the tool set and
 * the system prompt.
 *
 * Plan mode outranks goal mode, which outranks debug, which outranks ask: the
 * modes are mutually exclusive in practice, and the order keeps the answer
 * stable when a stale flag is left behind by a mode that is being torn down.
 */
export function deriveModeSnapshot(flags: ModeFlags): ModeSnapshot {
	return {
		mode:
			flags.planModeEnabled || flags.planModePaused
				? "plan"
				: flags.goalModeEnabled || flags.goalModePaused
					? "goal"
					: flags.debugModeEnabled
						? "debug"
						: flags.askModeEnabled
							? "ask"
							: "none",
		planPaused: flags.planModePaused,
		goalPaused: flags.goalModePaused,
	};
}

/** The snapshot of a harness that is in agent mode. */
export const AGENT_MODE_SNAPSHOT: ModeSnapshot = { mode: "none", planPaused: false, goalPaused: false };

/** The one-line statement of the current mode, for the system prompt. */
export function formatCurrentModeLine(snapshot: ModeSnapshot): string {
	const suspended = snapshot.planPaused || snapshot.goalPaused ? " (paused)" : "";
	return `Current harness mode: ${MODE_LABELS[snapshot.mode]}${suspended}.`;
}

/**
 * True when asking for `target` would change nothing.
 *
 * A suspended plan/goal still *is* that mode: requesting it again resumes it,
 * so it is not a no-op and must not be short-circuited.
 */
export function modeRequestIsNoop(snapshot: ModeSnapshot, target: SessionMode): boolean {
	if (snapshot.mode !== target) return false;
	if (target === "plan" && snapshot.planPaused) return false;
	if (target === "goal" && snapshot.goalPaused) return false;
	return true;
}

/** The outcome of a mode switch request. */
export interface ModeSwitchOutcome {
	status: "switched" | "already" | "cancelled" | "unavailable" | "failed";
	/** The mode the harness is in after the attempt. */
	mode: SessionMode;
	/**
	 * The model-visible summary. This is the *only* place the model learns
	 * whether the switch happened — the status line is TUI-only — so it has to
	 * carry the truth, including the mode the harness ended up in.
	 */
	message: string;
}

/**
 * The mode controller the session exposes to the tool layer.
 *
 * The TUI owns the mode state; the session relays it. That keeps the tool
 * layer free of TUI internals while still letting a tool read the live mode
 * and ask for a switch.
 */
export interface ModeController {
	/** The live mode snapshot, derived from the harness state. */
	getModeSnapshot(): ModeSnapshot;
	/** Ask the user and perform the switch. Never throws for a declined switch. */
	requestModeSwitch(target: SessionMode, reason?: string): Promise<ModeSwitchOutcome>;
}
