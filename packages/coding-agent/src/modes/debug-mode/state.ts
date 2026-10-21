import type { LogServerHandle } from "./log-server";

export interface DebugModeState {
	enabled: boolean;
	sessionId: string;
	logPath: string;
	ingestUrl: string;
	/** Live log server; undefined while the server is down or failed to start. */
	server: LogServerHandle["server"] | undefined;
}
