export interface DebugModeState {
	enabled: boolean;
	sessionId: string;
	logPath: string;
	ingestUrl: string;
	previousModel: string;
	previousThinkingLevel: string;
	server: unknown;
}
