export interface PlanModeLoadedFrom {
	name: string;
	absolutePath: string;
	location: string;
	url: string;
}

export interface PlanModeState {
	enabled: boolean;
	planFilePath: string;
	workflow?: "parallel" | "iterative";
	reentry?: boolean;
	loadedFrom?: PlanModeLoadedFrom;
}
