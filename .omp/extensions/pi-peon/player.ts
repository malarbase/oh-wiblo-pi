/**
 * Cross-platform async audio player for pi-peon.
 *
 * Design rules from the CESP spec:
 *
 *   - Always play **async**, never block the CLI.
 *   - Pick the first working backend per platform; skip silently if
 *     nothing is available.
 *   - Master volume is `0.0..1.0`; we scale per-backend.
 *   - Supported formats: WAV / MP3 / OGG.
 *
 * Probe order:
 *   darwin  afplay
 *   linux   pw-play → paplay → ffplay → mpv → play (sox) → aplay
 *   win32   powershell (System.Windows.Media.MediaPlayer)
 */

import { spawn, type ChildProcess } from "node:child_process";

export interface PlayerSpec {
	label: string;
	command: string;
	buildArgs: (file: string, volume: number) => string[];
}

const PROBE_TIMEOUT_MS = 5_000;

function probesForPlatform(platform: NodeJS.Platform): PlayerSpec[] {
	if (platform === "darwin") {
		return [
			{
				label: "afplay",
				command: "afplay",
				buildArgs: (f, v) => ["-v", clamp01(v).toFixed(2), f],
			},
		];
	}
	if (platform === "win32") {
		return [
			{
				label: "powershell (MediaPlayer)",
				command: "powershell.exe",
				buildArgs: (f, v) => [
					"-NoProfile",
					"-Command",
					`$p = New-Object System.Windows.Media.MediaPlayer; ` +
						`$p.Open([Uri]::new((Resolve-Path '${f.replace(/'/g, "''")}'))); ` +
						`$p.Volume = ${clamp01(v).toFixed(2)}; ` +
						`$p.Play(); ` +
						`Start-Sleep -Seconds 10`,
				],
			},
		];
	}
	// linux / *bsd / *nix
	return [
		{
			label: "pw-play (PipeWire)",
			command: "pw-play",
			buildArgs: (f, v) => [`--volume=${clamp01(v).toFixed(2)}`, f],
		},
		{
			label: "paplay (PulseAudio)",
			command: "paplay",
			buildArgs: (f, v) => [`--volume=${Math.round(clamp01(v) * 65536)}`, f],
		},
		{
			label: "ffplay (FFmpeg)",
			command: "ffplay",
			buildArgs: (f, v) => [
				"-nodisp",
				"-autoexit",
				"-loglevel",
				"quiet",
				"-volume",
				String(Math.round(clamp01(v) * 100)),
				f,
			],
		},
		{
			label: "mpv",
			command: "mpv",
			buildArgs: (f, v) => [
				"--no-terminal",
				`--volume=${Math.round(clamp01(v) * 100)}`,
				f,
			],
		},
		{
			label: "play (SoX)",
			command: "play",
			buildArgs: (f, v) => ["-v", clamp01(v).toFixed(2), "-q", f],
		},
		{
			label: "aplay (ALSA)",
			command: "aplay",
			buildArgs: (f, _v) => ["-q", f],
		},
	];
}

export function clamp01(v: number): number {
	if (!Number.isFinite(v)) return 0;
	if (v < 0) return 0;
	if (v > 1) return 1;
	return v;
}

export interface ExecLike {
	(
		command: string,
		args: string[],
		options?: { timeout?: number },
	): Promise<{ code: number | null }>;
}

let detectedSpec: PlayerSpec | null | undefined;
let detectionInFlight: Promise<PlayerSpec | null> | undefined;

export function resetPlayerCache(): void {
	detectedSpec = undefined;
	detectionInFlight = undefined;
}

function buildProbe(
	target: string,
	platform: NodeJS.Platform,
): { command: string; args: string[] } {
	if (platform === "win32") return { command: "where", args: [target] };
	return { command: "which", args: [target] };
}

export function detectPlayer(
	exec: ExecLike,
	platform: NodeJS.Platform = process.platform,
): Promise<PlayerSpec | null> {
	if (detectedSpec !== undefined) return Promise.resolve(detectedSpec);
	if (detectionInFlight) return detectionInFlight;
	detectionInFlight = (async () => {
		for (const spec of probesForPlatform(platform)) {
			const probe = buildProbe(spec.command, platform);
			try {
				const r = await exec(probe.command, probe.args, {
					timeout: PROBE_TIMEOUT_MS,
				});
				if (r.code === 0) {
					detectedSpec = spec;
					return spec;
				}
			} catch {
				// try next
			}
		}
		detectedSpec = null;
		return null;
	})();
	return detectionInFlight;
}

export function play(
	spec: PlayerSpec,
	file: string,
	volume: number,
): ChildProcess {
	const args = spec.buildArgs(file, volume);
	return spawn(spec.command, args, { stdio: "ignore", detached: true });
}
