import * as fs from "node:fs";
import * as path from "node:path";

export interface LogServerHandle {
	port: number;
	ingestUrl: string;
	server: { stop: () => void };
}

/**
 * Start a local HTTP log ingestion server for Debug mode.
 * Binds to 127.0.0.1 on an OS-assigned port (port 0).
 * Accepts POST /ingest/<sessionId> and appends the body as
 * an NDJSON line to .pi/debug-<sessionId>.log.
 */
export async function startLogServer(sessionId: string, logPath: string): Promise<LogServerHandle> {
	const resolvedLogPath = path.resolve(logPath);
	const logDir = path.dirname(resolvedLogPath);

	if (!fs.existsSync(logDir)) {
		fs.mkdirSync(logDir, { recursive: true });
	}

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			const match = url.pathname.match(/^\/ingest\/(.+)$/);

			if (req.method !== "POST" || !match) {
				return new Response("Not Found", { status: 404 });
			}

			try {
				const body = await req.text();
				const line = body.endsWith("\n") ? body : `${body}\n`;
				fs.appendFileSync(resolvedLogPath, line);
				return new Response("OK", { status: 200 });
			} catch {
				return new Response("Internal Server Error", { status: 500 });
			}
		},
	});

	const port = server.port ?? 0;
	const ingestUrl = `http://127.0.0.1:${port}/ingest/${sessionId}`;

	return {
		port,
		ingestUrl,
		server: {
			stop: () => server.stop(),
		},
	};
}
