export interface PlanModeLoadedFrom {
	name: string;
	absolutePath: string;
	location: "project" | "session";
	/** Original URL form (`local://...` for session, absolute path for project). */
	url: string;
}

export interface PlanModeState {
	enabled: boolean;
	planFilePath: string;
	workflow?: "parallel" | "iterative";
	reentry?: boolean;
	loadedFrom?: PlanModeLoadedFrom;
}
