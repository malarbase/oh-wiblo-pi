/**
 * pi-peon — CESP / OpenPeon sound pack player for pi (OWP-compatible fork).
 */

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
	envDefaults,
	getConfigPath,
	isCategoryEnabled,
	loadOrInitConfig,
	saveConfig,
	type PeonConfig,
} from "./config.ts";
import {
	CESP_CATEGORIES,
	listInstalledPacks,
	loadPack,
	resolveCategory,
	type CespCategory,
	type InstalledPack,
} from "./pack.ts";
import {
	detectPlayer,
	play,
	resetPlayerCache,
	type ExecLike,
	type PlayerSpec,
} from "./player.ts";
import { createPickerState, pickSound } from "./picker.ts";
import { fetchRegistry, resetRegistryCache, type RegistryEntry } from "./registry.ts";
import {
	installPack as installPackFromRegistry,
} from "./install.ts";

const SPAM_THRESHOLD = 3;
const SPAM_WINDOW_MS = 5_000;
const SPAM_COOLDOWN_MS = 10_000;

export default function piPeon(pi: ExtensionAPI) {
	let config: PeonConfig = loadOrInitConfig();
	let activePack: InstalledPack | null = loadPack(config.activePack);
	let playerSpec: PlayerSpec | null | undefined;
	let cliDisabled = false;
	const picker = createPickerState();
	let toolsUsedThisTurn = false;
	const inputTimestamps: number[] = [];
	let lastSpamPlayedAt = 0;

	pi.registerFlag("no-peon", { type: "boolean", description: "Disable pi-peon sound playback for this session.", default: false });

	const persist = (ctx?: ExtensionContext): void => {
		try { saveConfig(config); } catch (err) {
			ctx?.ui.notify(`peon: failed to save config: ${err instanceof Error ? err.message : String(err)}`, "error");
		}
	};

	const refreshActivePack = (): void => { activePack = loadPack(config.activePack); };

	const isActive = (): boolean => {
		if (cliDisabled || config.muted || !activePack || !playerSpec) return false;
		return true;
	};

	const playFor = (category: CespCategory): void => {
		if (!isActive() || !isCategoryEnabled(config, category)) return;
		const pack = activePack;
		if (!pack || !playerSpec) return;
		const candidates = resolveCategory(pack, category);
		if (candidates.length === 0) return;
		const chosen = pickSound(picker, pack.name, category, candidates);
		if (!chosen) return;
		try {
			const child = play(playerSpec, chosen.absPath, config.volume);
			child.once("error", () => {});
			child.unref();
		} catch { /* best-effort */ }
	};

	pi.on("session_start", async (event, ctx) => {
		config = loadOrInitConfig(); refreshActivePack();
		cliDisabled = pi.getFlag("no-peon") === true;
		toolsUsedThisTurn = false; inputTimestamps.length = 0; lastSpamPlayedAt = 0;
		resetPlayerCache(); playerSpec = undefined;
		if (cliDisabled) return;
		try {
			const exec: ExecLike = async (cmd, args, opts) => { const r = await pi.exec(cmd, args, opts ?? {}); return { code: r.code }; };
			playerSpec = await detectPlayer(exec);
		} catch { playerSpec = null; }
		const wantsWelcome = event.reason === "startup" || event.reason === "new";
		if (!activePack) { /* auto-install handled below */ }
		else if (wantsWelcome) playFor("session.start");
	});

	pi.on("agent_start", async () => { toolsUsedThisTurn = false; playFor("task.acknowledge"); });
	pi.on("tool_execution_start", async () => { toolsUsedThisTurn = true; });
	pi.on("agent_end", async () => {
		playFor(toolsUsedThisTurn ? "task.complete" : "input.required");
		toolsUsedThisTurn = false;
	});
	pi.on("tool_result", async (event) => { if (event.isError) playFor("task.error"); });
	pi.on("after_provider_response", (event) => { if (event.status === 429) playFor("resource.limit"); });
	pi.on("input", async () => {
		const now = Date.now(); inputTimestamps.push(now);
		while (inputTimestamps.length > 0 && now - inputTimestamps[0]! > SPAM_WINDOW_MS) inputTimestamps.shift();
		if (inputTimestamps.length >= SPAM_THRESHOLD && now - lastSpamPlayedAt > SPAM_COOLDOWN_MS) {
			lastSpamPlayedAt = now; playFor("user.spam");
		}
		return undefined;
	});

	// ── slash command ────────────────────────────────────────────────

	const showStatus = (ctx: ExtensionContext): void => {
		ctx.ui.notify(`peon: active=${activePack?.name ?? config.activePack} player=${playerSpec?.label ?? "none"} volume=${Math.round(config.volume * 100)}% muted=${config.muted}`, "info");
	};
	const mute = (ctx: ExtensionContext): void => { config = { ...config, muted: true }; persist(ctx); ctx.ui.notify("peon: muted.", "info"); };
	const unmute = (ctx: ExtensionContext): void => { config = { ...config, muted: false }; persist(ctx); ctx.ui.notify("peon: unmuted.", "info"); };

	const test = (ctx: ExtensionContext, arg: string): void => {
		if (!activePack) { ctx.ui.notify("peon: no pack loaded.", "warning"); return; }
		if (!playerSpec) { ctx.ui.notify("peon: no audio player detected.", "warning"); return; }
		const cat = (arg.trim() || "session.start") as CespCategory;
		if (!(CESP_CATEGORIES as readonly string[]).includes(cat)) {
			ctx.ui.notify(`peon: unknown category "${cat}".`, "warning"); return;
		}
		const sounds = resolveCategory(activePack, cat);
		if (sounds.length === 0) { ctx.ui.notify(`peon: pack has no sounds for ${cat}.`, "info"); return; }
		const chosen = sounds[Math.floor(Math.random() * sounds.length)]!;
		try { play(playerSpec, chosen.absPath, config.volume).once("error", () => {}).unref(); }
		catch { /* best-effort */ }
		ctx.ui.notify(`peon: playing ${cat} → ${chosen.label}`, "info");
	};

	const resetConfig = (ctx: ExtensionContext): void => { config = envDefaults(); persist(ctx); refreshActivePack(); ctx.ui.notify("peon: reset.", "info"); };

	const openSettings = async (ctx: ExtensionContext): Promise<void> => {
		const options = [
			`Packs… (active: ${activePack?.displayName ?? config.activePack})`,
			`Volume: ${Math.round(config.volume * 100)}%`,
			`Muted: ${config.muted ? "yes" : "no"}`,
			...CESP_CATEGORIES.map((c) => `${c}: ${isCategoryEnabled(config, c) ? "on" : "off"}`),
		];
		const choice = await ctx.ui.select("peon settings", options);
		if (!choice) return;
		if (choice.startsWith("Packs…")) {
			const packs = listInstalledPacks();
			const packOptions = packs.map((p) => `${p.displayName} (${p.name})`);
			const pick = await ctx.ui.select("Choose active pack", packOptions);
			if (pick) {
				const match = pick.match(/\(([^)]+)\)$/);
				const name = match ? match[1] : pick;
				if (loadPack(name)) { config = { ...config, activePack: name }; refreshActivePack(); persist(ctx); ctx.ui.notify(`peon: active pack set to "${name}".`, "info"); }
			}
			return;
		}
		if (choice.startsWith("Volume:")) {
			const raw = await ctx.ui.input("Enter volume 0–100", String(Math.round(config.volume * 100)));
			if (raw !== undefined) { const n = Number(raw); if (!Number.isNaN(n)) { config = { ...config, volume: Math.max(0, Math.min(100, n)) / 100 }; persist(ctx); } }
			return;
		}
		if (choice.startsWith("Muted:")) { config = { ...config, muted: !config.muted }; persist(ctx); return; }
		for (const cat of CESP_CATEGORIES) { if (choice.startsWith(cat)) { config.enabledCategories = { ...config.enabledCategories, [cat]: !isCategoryEnabled(config, cat) }; persist(ctx); return; } }
	};

	const dispatch = async (args: string, ctx: ExtensionContext): Promise<void> => {
		const trimmed = (args ?? "").trim();
		const tokens = trimmed.split(/\s+/).filter(Boolean);
		const cmd = tokens[0]?.toLowerCase() ?? "";
		const rest = trimmed.slice(cmd.length).trim();
		if (!cmd) return openSettings(ctx);
		if (cmd === "status") return showStatus(ctx);
		if (cmd === "mute") return mute(ctx);
		if (cmd === "unmute") return unmute(ctx);
		if (cmd === "test") return test(ctx, rest);
		if (cmd === "reset") return resetConfig(ctx);
		if (cmd === "install") {
			const packNames = rest.split(/\s+/).filter(Boolean);
			if (packNames.length === 0) { ctx.ui.notify("Usage: /peon install <pack-name>", "info"); return; }
			let entries: RegistryEntry[];
			try { entries = await fetchRegistry(); } catch (err) { ctx.ui.notify(`peon: registry fetch failed.`, "error"); return; }
			for (const name of packNames) {
				const entry = entries.find((e) => e.name === name);
				if (!entry) { ctx.ui.notify(`peon: "${name}" not found.`, "warning"); continue; }
				ctx.ui.notify(`peon: installing "${name}"…`, "info");
				try { await installPackFromRegistry(entry); config = { ...config, activePack: name }; refreshActivePack(); persist(ctx); ctx.ui.notify(`peon: installed.`, "info"); }
				catch (err) { ctx.ui.notify(`peon: install failed: ${err instanceof Error ? err.message : String(err)}`, "error"); }
			}
			return;
		}
		ctx.ui.notify("Usage: /peon [status|mute|unmute|test <category>|reset|install <pack>]", "info");
	};

	pi.registerCommand("peon", {
		description: "Open peon sound settings (no args). Subcommands: status | mute | unmute | test <category> | reset | install <pack>",
		handler: dispatch,
		getArgumentCompletions: (prefix: string) => {
			const tokens = prefix.split(/\s+/);
			const first = tokens[0] ?? "";
			const subs = ["status", "mute", "unmute", "test", "reset", "install"];

			if (first === "test" && /\s/.test(prefix)) {
				const tail = (tokens[1] ?? "").toLowerCase();
				return CESP_CATEGORIES.filter((c) =>
					c.toLowerCase().startsWith(tail),
				).map((c) => ({ value: `test ${c}`, label: c }));
			}

			if (subs.includes(first) && /\s/.test(prefix)) return null;
			const lc = prefix.toLowerCase();
			return subs
				.filter((s) => s.toLowerCase().startsWith(lc))
				.map((s) => ({
					value: s === "test" || s === "install" ? `${s} ` : s,
					label: s,
				}));
		},
	});
}
