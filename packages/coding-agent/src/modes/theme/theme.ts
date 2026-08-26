import * as fs from "node:fs";
import * as path from "node:path";
import { detectMacOSAppearance, MacAppearanceObserver } from "@oh-my-pi/pi-natives";
import type { Terminal, TerminalAppearance } from "@oh-my-pi/pi-tui";
import { colorLuma, getCustomThemesDir, logger } from "@oh-my-pi/pi-utils";
import { ansi256ToHex, resolveThemeColors, resolveVarRefs } from "./color";
import { type CreateThemeOptions, getBuiltinThemes, loadTheme, loadThemeJson, loadThemeSync } from "./loader";
import type { ThemeColor, ThemeJson } from "./schema";
import type { SymbolPreset } from "./symbols";
import type { Theme } from "./theme-class";

export { getLanguageFromPath, isMarkdownPath } from "../../utils/lang-from-path";
export { getAvailableThemes, getAvailableThemesWithPaths, getThemeByName, type ThemeInfo } from "./loader";
export { isValidThemeColor, type ThemeBg, type ThemeColor } from "./schema";
export {
	getAvailableSymbolPresets,
	isValidSymbolPreset,
	type SpinnerType,
	type SymbolKey,
	type SymbolPreset,
} from "./symbols";
export { Theme } from "./theme-class";
export {
	createHighlightStream,
	getEditorTheme,
	getMarkdownTheme,
	getSelectListTheme,
	getSettingsListTheme,
	getSymbolTheme,
	highlightCode,
	setMarkdownMermaidRendering,
	warmHighlighter,
} from "./tui-adapters";

/** Appearance detected via OSC 11 background color query, or undefined if not yet available. */
var terminalReportedAppearance: "dark" | "light" | undefined;

/** Appearance reported by the macOS fallback observer, or undefined if not yet available. */
var macOSReportedAppearance: "dark" | "light" | undefined;

function shouldUseMacOSAppearanceFallback(): boolean {
	// Zellij currently breaks OSC 11 passthrough on macOS, so terminal-derived
	// appearance cannot be trusted there. Fall back to host macOS appearance
	// without letting it override valid terminal signals elsewhere.
	return process.platform === "darwin" && !!Bun.env.ZELLIJ;
}

function detectTerminalBackground(): "dark" | "light" {
	// Tier 1: terminal-reported appearance from OSC 11 luminance.
	if (!shouldUseMacOSAppearanceFallback() && terminalReportedAppearance) {
		return terminalReportedAppearance;
	}

	// Tier 2: COLORFGBG env var (static at process start, but still terminal-derived).
	const colorfgbg = Bun.env.COLORFGBG || "";
	if (colorfgbg) {
		const parts = colorfgbg.split(";");
		if (parts.length >= 2) {
			const bg = parseInt(parts[1], 10);
			if (!Number.isNaN(bg)) return bg < 8 ? "dark" : "light";
		}
	}

	// Tier 3: host macOS appearance for known-broken terminal paths only.
	if (shouldUseMacOSAppearanceFallback()) {
		const macAppearance = macOSReportedAppearance ?? detectMacOSAppearance();
		if (macAppearance) return macAppearance;
	}

	return "dark";
}

function getDefaultTheme(): string {
	const bg = detectTerminalBackground();
	return bg === "light" ? autoLightTheme : autoDarkTheme;
}

// ============================================================================
// Global Theme Instance
// ============================================================================

export var theme: Theme;
var currentThemeName: string | undefined;

/** Get the name of the currently active theme. */
export function getCurrentThemeName(): string | undefined {
	return currentThemeName;
}

/** Returns unstyled `text` before `initTheme()` assigns the global theme; use only for early-render paths. */
export function fgOrPlain(color: ThemeColor, text: string, styledText: string = text): string {
	return typeof theme === "undefined" ? text : theme.fg(color, styledText);
}
export interface ThemeChangeEvent {
	/** Preview/presentation-only changes should repaint live UI without replacing native scrollback. */
	ephemeral?: boolean;
}

var currentSymbolPresetOverride: SymbolPreset | undefined;
var currentColorBlindMode: boolean = false;
var themeWatcher: fs.FSWatcher | undefined;
var themeReloadTimer: NodeJS.Timeout | undefined;
var sigwinchHandler: (() => void) | undefined;
var autoDetectedTheme: boolean = false;
var autoDarkTheme: string = "dark";
var autoLightTheme: string = "light";
var onThemeChangeCallback: ((event: ThemeChangeEvent) => void) | undefined;
var themeLoadRequestId: number = 0;
let themeEpoch = 0;

function getCurrentThemeOptions(): CreateThemeOptions {
	return {
		symbolPresetOverride: currentSymbolPresetOverride,
		colorBlindMode: currentColorBlindMode,
	};
}
function configureTheme(
	symbolPreset?: SymbolPreset,
	colorBlindMode?: boolean,
	darkTheme?: string,
	lightTheme?: string,
): string {
	autoDetectedTheme = true;
	autoDarkTheme = darkTheme ?? "dark";
	autoLightTheme = lightTheme ?? "light";
	currentSymbolPresetOverride = symbolPreset;
	currentColorBlindMode = colorBlindMode ?? false;
	const name = getDefaultTheme();
	currentThemeName = name;
	return name;
}

/** Initialize the active theme synchronously before the first terminal paint. */
export function initThemeSync(
	symbolPreset?: SymbolPreset,
	colorBlindMode?: boolean,
	darkTheme?: string,
	lightTheme?: string,
): void {
	const name = configureTheme(symbolPreset, colorBlindMode, darkTheme, lightTheme);
	const options: CreateThemeOptions = {
		symbolPresetOverride: currentSymbolPresetOverride,
		colorBlindMode: currentColorBlindMode,
	};
	try {
		theme = loadThemeSync(name, options);
	} catch (error) {
		logger.debug("Theme loading failed, falling back to dark theme", { error: String(error) });
		currentThemeName = "dark";
		theme = loadThemeSync("dark", options);
	}
}

/** Initialize the default theme only when no earlier prepaint initialized one. */
export async function ensureTheme(): Promise<void> {
	if (typeof theme !== "undefined") return;
	await initTheme();
}

export async function initTheme(
	enableWatcher: boolean = false,
	symbolPreset?: SymbolPreset,
	colorBlindMode?: boolean,
	darkTheme?: string,
	lightTheme?: string,
): Promise<void> {
	const name = configureTheme(symbolPreset, colorBlindMode, darkTheme, lightTheme);
	try {
		theme = await loadTheme(name, getCurrentThemeOptions());
		if (enableWatcher) {
			await startThemeWatcher();
			startSigwinchListener();
		}
	} catch (err) {
		logger.debug("Theme loading failed, falling back to dark theme", { error: String(err) });
		currentThemeName = "dark";
		theme = await loadTheme("dark", getCurrentThemeOptions());
		// Don't start watcher for fallback theme
	}
}

export async function setTheme(
	name: string,
	enableWatcher: boolean = false,
): Promise<{ success: boolean; error?: string }> {
	autoDetectedTheme = false;
	currentThemeName = name;
	const requestId = ++themeLoadRequestId;
	try {
		const loadedTheme = await loadTheme(name, getCurrentThemeOptions());
		if (requestId !== themeLoadRequestId) {
			return { success: false, error: "Theme change superseded by a newer request" };
		}
		theme = loadedTheme;
		if (enableWatcher) {
			await startThemeWatcher();
		}
		notifyThemeChange();
		return { success: true };
	} catch (error) {
		if (requestId !== themeLoadRequestId) {
			return { success: false, error: "Theme change superseded by a newer request" };
		}
		// Theme is invalid - fall back to dark theme
		currentThemeName = "dark";
		theme = await loadTheme("dark", getCurrentThemeOptions());
		// The active theme just changed to the fallback — bump the epoch so memoized
		// renderers (e.g. ToolExecutionComponent) re-shape with the fallback colors
		// instead of holding the failed theme's stale styling.
		notifyThemeChange();
		// Don't start watcher for fallback theme
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function previewTheme(
	name: string,
	event: ThemeChangeEvent = { ephemeral: true },
): Promise<{ success: boolean; error?: string }> {
	const requestId = ++themeLoadRequestId;
	try {
		const loadedTheme = await loadTheme(name, getCurrentThemeOptions());
		if (requestId !== themeLoadRequestId) {
			return { success: false, error: "Theme preview superseded by a newer request" };
		}
		theme = loadedTheme;
		notifyThemeChange(event);
		return { success: true };
	} catch (error) {
		if (requestId !== themeLoadRequestId) {
			return { success: false, error: "Theme preview superseded by a newer request" };
		}
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Enable auto-detection mode, switching to the appropriate dark/light theme.
 */
export function enableAutoTheme(event: ThemeChangeEvent = {}): void {
	autoDetectedTheme = true;
	reevaluateAutoTheme("enableAutoTheme", event);
}

/**
 * Update the theme mappings for auto-detection mode.
 * When a dark/light mapping changes and auto-detection is active, re-evaluate the theme.
 */
export function setAutoThemeMapping(mode: "dark" | "light", themeName: string): void {
	if (mode === "dark") autoDarkTheme = themeName;
	else autoLightTheme = themeName;
	reevaluateAutoTheme("setAutoThemeMapping");
}

/**
 * Called when the terminal detects a dark/light appearance change.
 * The terminal layer queries OSC 11 (background color) and computes luminance;
 * Mode 2031 notifications trigger re-queries rather than providing the value directly.
 */
export function onTerminalAppearanceChange(
	mode: "dark" | "light",
	event: ThemeChangeEvent = { ephemeral: true },
): void {
	if (terminalReportedAppearance === mode) return;
	terminalReportedAppearance = mode;
	reevaluateAutoTheme("terminal appearance", event);
}

export function setThemeInstance(themeInstance: Theme): void {
	autoDetectedTheme = false;
	theme = themeInstance;
	currentThemeName = "<in-memory>";
	stopThemeWatcher();
	notifyThemeChange({ ephemeral: true });
}

/**
 * Set the symbol preset override, recreating the theme with the new preset.
 */
export async function setSymbolPreset(preset: SymbolPreset): Promise<void> {
	currentSymbolPresetOverride = preset;
	if (!currentThemeName) return;

	const requestId = ++themeLoadRequestId;
	try {
		const loadedTheme = await loadTheme(currentThemeName, getCurrentThemeOptions());
		if (requestId !== themeLoadRequestId) return;
		theme = loadedTheme;
	} catch {
		if (requestId !== themeLoadRequestId) return;
		// Fall back to dark theme with new preset
		theme = await loadTheme("dark", getCurrentThemeOptions());
		if (requestId !== themeLoadRequestId) return;
	}
	notifyThemeChange({ ephemeral: true });
}

/**
 * Get the current symbol preset override.
 */
export function getSymbolPresetOverride(): SymbolPreset | undefined {
	return currentSymbolPresetOverride;
}

/**
 * Set color blind mode, recreating the theme with the new setting.
 * When enabled, uses blue instead of green for diff additions.
 */
export async function setColorBlindMode(enabled: boolean): Promise<void> {
	currentColorBlindMode = enabled;
	if (!currentThemeName) return;

	const requestId = ++themeLoadRequestId;
	try {
		const loadedTheme = await loadTheme(currentThemeName, getCurrentThemeOptions());
		if (requestId !== themeLoadRequestId) return;
		theme = loadedTheme;
	} catch {
		if (requestId !== themeLoadRequestId) return;
		// Fall back to dark theme
		theme = await loadTheme("dark", getCurrentThemeOptions());
		if (requestId !== themeLoadRequestId) return;
	}
	notifyThemeChange({ ephemeral: true });
}

/**
 * Get the current color blind mode setting.
 */
export function getColorBlindMode(): boolean {
	return currentColorBlindMode;
}

export function onThemeChange(callback: (event: ThemeChangeEvent) => void): () => void {
	onThemeChangeCallback = callback;
	return () => {
		if (onThemeChangeCallback === callback) {
			onThemeChangeCallback = undefined;
		}
	};
}

/**
 * Monotonic counter bumped on any theme-affecting change that should invalidate
 * cached renders: theme swaps and reloads (including the invalid-theme dark
 * fallback), theme previews, symbol-preset changes, and color-blind-mode
 * changes — everything that routes through {@link notifyThemeChange}. Consumers
 * key cached renders on it so the next render re-shapes their output.
 */
export function getThemeEpoch(): number {
	return themeEpoch;
}

/** Bump the theme epoch and notify the registered theme-change listener. */
function notifyThemeChange(event: ThemeChangeEvent = {}): void {
	themeEpoch++;
	onThemeChangeCallback?.(event);
}

/**
 * Get available symbol presets.
 */
export function getAvailableSymbolPresets(): SymbolPreset[] {
	return ["unicode", "nerd", "ascii"];
}

/**
 * Check if a string is a valid symbol preset.
 */
export function isValidSymbolPreset(preset: string): preset is SymbolPreset {
	return preset === "unicode" || preset === "nerd" || preset === "ascii";
}

async function startThemeWatcher(): Promise<void> {
	stopThemeWatcher();

	// Only watch if it's a custom theme (not built-in)
	if (!currentThemeName || currentThemeName === "dark" || currentThemeName === "light") {
		return;
	}

	const customThemesDir = getCustomThemesDir();
	const watchedThemeName = currentThemeName;
	const watchedFileName = `${watchedThemeName}.json`;
	const themeFile = path.join(customThemesDir, watchedFileName);

	// Only watch if the file exists
	if (!fs.existsSync(themeFile)) {
		return;
	}

	const scheduleReload = () => {
		if (themeReloadTimer) {
			clearTimeout(themeReloadTimer);
		}
		themeReloadTimer = setTimeout(() => {
			themeReloadTimer = undefined;

			// Ignore stale timers after switching themes or stopping the watcher
			if (currentThemeName !== watchedThemeName) {
				return;
			}

			// Keep the last successfully loaded theme active if the file is temporarily missing
			if (!fs.existsSync(themeFile)) {
				return;
			}

			loadTheme(watchedThemeName, getCurrentThemeOptions())
				.then(loadedTheme => {
					theme = loadedTheme;
					notifyThemeChange({ ephemeral: true });
				})
				.catch(() => {
					// Ignore errors (file might be in invalid state while being edited)
				});
		}, 100);
	};

	try {
		themeWatcher = fs.watch(customThemesDir, (_eventType, filename) => {
			if (currentThemeName !== watchedThemeName) {
				return;
			}
			if (!filename) {
				scheduleReload();
				return;
			}
			const changedFile = String(filename);
			if (changedFile !== watchedFileName) {
				return;
			}
			scheduleReload();
		});
	} catch {
		// Ignore errors starting watcher
	}
}

/**
 * Load and apply an already-resolved auto-theme name.
 */
function applyResolvedAutoTheme(resolved: string, debugLabel: string, event: ThemeChangeEvent): void {
	if (resolved === currentThemeName) return;
	currentThemeName = resolved;
	const requestId = ++themeLoadRequestId;
	loadTheme(resolved, getCurrentThemeOptions())
		.then(loadedTheme => {
			if (requestId !== themeLoadRequestId) return;
			theme = loadedTheme;
			notifyThemeChange(event);
		})
		.catch(err => {
			if (requestId !== themeLoadRequestId) return;
			logger.debug(`Theme switch on ${debugLabel} failed`, { error: String(err) });
		});
}

/**
 * Shared logic for re-evaluating the auto-detected theme.
 * An explicit appearance is provisional input and does not alter terminal-reported state.
 */
function reevaluateAutoTheme(debugLabel: string, event: ThemeChangeEvent = {}, appearance?: "dark" | "light"): void {
	if (!autoDetectedTheme) return;
	const resolved =
		appearance === undefined ? getDefaultTheme() : appearance === "dark" ? autoDarkTheme : autoLightTheme;
	applyResolvedAutoTheme(resolved, debugLabel, event);
}

function reevaluateAutoThemeForAppearance(debugLabel: string, appearance?: "dark" | "light"): void {
	reevaluateAutoTheme(debugLabel, { ephemeral: true }, appearance);
}

// ============================================================================
// macOS Appearance Fallback Observer
// ============================================================================

type MacOSAppearanceReprobeTerminal = Pick<
	Terminal,
	"appearance" | "onAppearanceChange" | "onAppearanceReport" | "onPrivateModeReport" | "refreshAppearance"
>;

const MACOS_APPEARANCE_REPROBE_DELAYS_MS = [25, 50, 100, 250, 500, 1000] as const;
const MACOS_APPEARANCE_RECONCILE_DELAY_MS = 1100;

/**
 * Fall back to native macOS appearance notifications when the terminal
 * explicitly confirms that Mode 2031 notifications are unsupported.
 *
 * Native notifications provisionally repaint from the host appearance and
 * synchronously trigger an OSC 11 probe, followed by a bounded burst of six
 * retries. A changed terminal classification cancels the sequence; otherwise
 * a confirmed terminal classification is restored at the validation deadline.
 */
export function startMacOSAppearanceReprobeFallback(terminal: MacOSAppearanceReprobeTerminal): () => void {
	let disposed = false;
	let observerStartAttempted = false;
	let observer: MacAppearanceObserver | undefined;
	let probeGeneration = 0;
	let probeSequenceActive = false;
	let probeBaseline: TerminalAppearance | undefined;
	let probeResponseConfirmed = false;
	const probeTimers = new Set<Timer>();
	let reconciliationTimer: Timer | undefined;

	const cancelProbeSequence = (): void => {
		probeGeneration++;
		probeSequenceActive = false;
		probeBaseline = undefined;
		probeResponseConfirmed = false;
		if (reconciliationTimer) {
			clearTimeout(reconciliationTimer);
			reconciliationTimer = undefined;
		}
		for (const timer of probeTimers) {
			clearTimeout(timer);
		}
		probeTimers.clear();
	};

	const scheduleProbeSequence = (): void => {
		cancelProbeSequence();
		if (disposed || !autoDetectedTheme) return;

		probeSequenceActive = true;
		probeBaseline = terminal.appearance;
		probeResponseConfirmed = false;
		const generation = probeGeneration;
		terminal.refreshAppearance?.();
		if (disposed || generation !== probeGeneration || !autoDetectedTheme) return;
		for (const delay of MACOS_APPEARANCE_REPROBE_DELAYS_MS) {
			const timer = setTimeout(() => {
				probeTimers.delete(timer);
				if (disposed || generation !== probeGeneration) return;
				if (!autoDetectedTheme) {
					cancelProbeSequence();
					return;
				}
				terminal.refreshAppearance?.();
			}, delay);
			timer.unref?.();
			probeTimers.add(timer);
		}
		reconciliationTimer = setTimeout(() => {
			reconciliationTimer = undefined;
			if (disposed || generation !== probeGeneration) return;
			const appearance = probeResponseConfirmed ? terminal.appearance : undefined;
			cancelProbeSequence();
			if (!autoDetectedTheme || !appearance) return;
			reevaluateAutoThemeForAppearance("macOS appearance reconciliation", appearance);
		}, MACOS_APPEARANCE_RECONCILE_DELAY_MS);
		reconciliationTimer.unref?.();
	};

	const unsubscribeAppearanceReport = terminal.onAppearanceReport?.(() => {
		if (disposed || !probeSequenceActive) return;
		probeResponseConfirmed = true;
	});

	terminal.onAppearanceChange(appearance => {
		if (disposed || !probeSequenceActive || appearance === probeBaseline) return;
		cancelProbeSequence();
	});

	terminal.onPrivateModeReport?.((mode, supported, confirmed) => {
		if (disposed || observerStartAttempted || mode !== 2031 || supported || confirmed !== true) {
			return;
		}

		observerStartAttempted = true;
		try {
			observer = MacAppearanceObserver.start((err, appearance) => {
				if (disposed) return;
				if (err) {
					cancelProbeSequence();
					return;
				}
				if (appearance === "dark" || appearance === "light") {
					reevaluateAutoThemeForAppearance("macOS provisional appearance", appearance);
				}
				scheduleProbeSequence();
			});
		} catch (err) {
			logger.warn("Failed to start macOS appearance reprobe observer", { err });
		}
	});

	return () => {
		if (disposed) return;
		disposed = true;
		cancelProbeSequence();
		if (unsubscribeAppearanceReport) unsubscribeAppearanceReport();
		const activeObserver = observer;
		observer = undefined;
		if (!activeObserver) return;
		try {
			activeObserver.stop();
		} catch (err) {
			logger.debug("Failed to stop macOS appearance reprobe observer", { err });
		}
	};
}

var macObserver: { stop(): void } | undefined;

function startMacAppearanceObserver(): void {
	stopMacAppearanceObserver();
	if (!shouldUseMacOSAppearanceFallback()) return;
	try {
		macOSReportedAppearance = detectMacOSAppearance() ?? undefined;
		macObserver = MacAppearanceObserver.start((err, appearance) => {
			if (!err && (appearance === "dark" || appearance === "light")) {
				macOSReportedAppearance = appearance;
				reevaluateAutoThemeForAppearance("macOS fallback");
			}
		});
	} catch (err) {
		logger.warn("Failed to start macOS appearance observer", { err });
	}
}

function stopMacAppearanceObserver(): void {
	if (macObserver) {
		macObserver.stop();
		macObserver = undefined;
	}
	macOSReportedAppearance = undefined;
}

// ============================================================================
// SIGWINCH Listener
// ============================================================================

/** Re-check appearance on SIGWINCH and switch dark/light when using auto-detected theme. */
function startSigwinchListener(): void {
	stopSigwinchListener();
	sigwinchHandler = () => {
		reevaluateAutoThemeForAppearance("SIGWINCH");
	};
	process.on("SIGWINCH", sigwinchHandler);
	startMacAppearanceObserver();
}

function stopSigwinchListener(): void {
	if (sigwinchHandler) {
		process.removeListener("SIGWINCH", sigwinchHandler);
		sigwinchHandler = undefined;
	}
	stopMacAppearanceObserver();
}

export function stopThemeWatcher(): void {
	if (themeReloadTimer) {
		clearTimeout(themeReloadTimer);
		themeReloadTimer = undefined;
	}
	if (themeWatcher) {
		themeWatcher.close();
		themeWatcher = undefined;
	}
	stopSigwinchListener();
	terminalReportedAppearance = undefined;
}

// ============================================================================
// HTML Export Helpers
// ============================================================================

/**
 * Convert a 256-color index to hex string.
 * Indices 0-15: basic colors (approximate)
 * Indices 16-231: 6x6x6 color cube
 * Indices 232-255: grayscale ramp
 */
function ansi256ToHex(index: number): string {
	// Basic colors (0-15) - approximate common terminal values
	const basicColors = [
		"#000000",
		"#800000",
		"#008000",
		"#808000",
		"#000080",
		"#800080",
		"#008080",
		"#c0c0c0",
		"#808080",
		"#ff0000",
		"#00ff00",
		"#ffff00",
		"#0000ff",
		"#ff00ff",
		"#00ffff",
		"#ffffff",
	];
	if (index < 16) {
		return basicColors[index];
	}

	// Color cube (16-231): 6x6x6 = 216 colors
	if (index < 232) {
		const cubeIndex = index - 16;
		const r = Math.floor(cubeIndex / 36);
		const g = Math.floor((cubeIndex % 36) / 6);
		const b = cubeIndex % 6;
		const toHex = (n: number) => (n === 0 ? 0 : 55 + n * 40).toString(16).padStart(2, "0");
		return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
	}

	// Grayscale (232-255): 24 shades
	const gray = 8 + (index - 232) * 10;
	const grayHex = gray.toString(16).padStart(2, "0");
	return `#${grayHex}${grayHex}${grayHex}`;
}

/**
 * Classify a parsed theme JSON as light/dark by the perceived luminance of its
 * status-line background. Mirrors {@link Theme.isLight} so the synchronous
 * helpers below stay in lockstep with the runtime classifier — see the comment
 * on `Theme.statusLineLuminance` for why `statusLineBg` is the source of truth
 * (themes like `porcelain` style a dark chat bubble on an otherwise-light
 * theme, so `userMessageBg` is unreliable).
 */
function isLightThemeJson(themeJson: ThemeJson): boolean {
	try {
		const resolved = resolveVarRefs(themeJson.colors.statusLineBg, themeJson.vars ?? {});
		const luminance = colorLuma(resolved);
		return luminance !== undefined && luminance > 0.5;
	} catch {
		return false;
	}
}

function getHtmlDefaultTextForSurface(surface: string | number | undefined): string {
	const luminance = surface === undefined ? undefined : colorLuma(surface);
	return luminance !== undefined && luminance > 0.5 ? "#000000" : "#e5e5e7";
}

function resolveThemeExportColors(themeJson: ThemeJson): {
	pageBg?: string;
	cardBg?: string;
	infoBg?: string;
} {
	const exportSection = themeJson.export;
	if (!exportSection) return {};

	const vars = themeJson.vars ?? {};
	const resolve = (value: string | number | undefined): string | undefined => {
		if (value === undefined) return undefined;
		if (typeof value === "number") return ansi256ToHex(value);
		if (value === "" || value.startsWith("#")) return value;
		const varName = value.startsWith("$") ? value.slice(1) : value;
		if (varName in vars) {
			const resolved = resolveVarRefs(varName, vars);
			return typeof resolved === "number" ? ansi256ToHex(resolved) : resolved;
		}
		return value;
	};

	return {
		pageBg: resolve(exportSection.pageBg),
		cardBg: resolve(exportSection.cardBg),
		infoBg: resolve(exportSection.infoBg),
	};
}

/**
 * Get resolved theme colors as CSS-compatible hex strings.
 * Used by HTML export to generate CSS custom properties.
 */
export async function getResolvedThemeColors(themeName?: string): Promise<Record<string, string>> {
	const name = themeName ?? getDefaultTheme();
	const themeJson = await loadThemeJson(name);
	const exportColors = resolveThemeExportColors(themeJson);
	const resolved = resolveThemeColors(themeJson.colors, themeJson.vars);

	// Empty foreground tokens use the terminal default color. In HTML export,
	// that default must contrast the export surface, not the TUI status line:
	// custom light themes can still export dark transcript cards when they omit
	// `export`, because generateThemeVars derives those cards from userMessageBg.
	const defaultText = getHtmlDefaultTextForSurface(
		exportColors.cardBg ?? exportColors.pageBg ?? resolved.userMessageBg,
	);

	const cssColors: Record<string, string> = {};
	for (const [key, value] of Object.entries(resolved)) {
		if (typeof value === "number") {
			cssColors[key] = ansi256ToHex(value);
		} else if (value === "") {
			// Empty means default terminal color - use sensible fallback for HTML
			cssColors[key] = defaultText;
		} else {
			cssColors[key] = value;
		}
	}
	return cssColors;
}

/**
 * Check if a theme is a "light" theme by analyzing its status-line background
 * luminance. Loads theme JSON synchronously (built-in or custom file on disk)
 * for callers in synchronous flows (settings migration, setup wizard).
 */
export function isLightTheme(themeName?: string): boolean {
	const name = themeName ?? "dark";
	const builtinThemes = getBuiltinThemes();
	let themeJson: ThemeJson | undefined;
	if (name in builtinThemes) {
		themeJson = builtinThemes[name];
	} else {
		try {
			const customPath = path.join(getCustomThemesDir(), `${name}.json`);
			const content = fs.readFileSync(customPath, "utf-8");
			themeJson = JSON.parse(content) as ThemeJson;
		} catch {
			return false;
		}
	}
	return isLightThemeJson(themeJson);
}

/**
 * Get explicit export colors from theme JSON, if specified.
 * Returns undefined for each color that isn't explicitly set.
 */
export async function getThemeExportColors(themeName?: string): Promise<{
	pageBg?: string;
	cardBg?: string;
	infoBg?: string;
}> {
	const name = themeName ?? getDefaultTheme();
	try {
		const themeJson = await loadThemeJson(name);
		return resolveThemeExportColors(themeJson);
	} catch {
		return {};
	}
}

// ============================================================================
// TUI Helpers
// ============================================================================

let cachedHighlightColorsFor: Theme | undefined;
let cachedHighlightColors: NativeHighlightColors | undefined;

function getHighlightColors(t: Theme): NativeHighlightColors {
	if (cachedHighlightColorsFor !== t || !cachedHighlightColors) {
		cachedHighlightColorsFor = t;
		cachedHighlightColors = {
			comment: t.getFgAnsi("syntaxComment"),
			keyword: t.getFgAnsi("syntaxKeyword"),
			function: t.getFgAnsi("syntaxFunction"),
			variable: t.getFgAnsi("syntaxVariable"),
			string: t.getFgAnsi("syntaxString"),
			number: t.getFgAnsi("syntaxNumber"),
			type: t.getFgAnsi("syntaxType"),
			operator: t.getFgAnsi("syntaxOperator"),
			punctuation: t.getFgAnsi("syntaxPunctuation"),
			inserted: t.getFgAnsi("toolDiffAdded"),
			deleted: t.getFgAnsi("toolDiffRemoved"),
		};
	}
	return cachedHighlightColors;
}

/**
 * Memoized native syntax highlight. Returns the joined ANSI string, or `null`
 * when the native tokenizer throws so callers can apply their own fallback.
 *
 * Keyed on `(lang, code)` and reset whenever the active `theme` instance
 * changes — the ANSI colors are baked into the highlighted output, so a theme
 * switch (which always reassigns `theme`) must invalidate every entry.
 *
 * Why this exists: animated tool blocks (eval/bash) repaint their box on every
 * ~33ms border-shimmer frame, and markdown re-lexes on every streamed delta.
 * Without memoization each frame can re-tokenize an unchanged code body through
 * the Rust FFI — ~26ms for 100 lines, ~40ms for 150 — consuming or overrunning
 * the 33ms frame budget and starving the spinner/render timers (the "TUI freeze").
 */
const HIGHLIGHT_CACHE_MAX = 256;
const highlightCache = new LRUCache<string, string>({ max: HIGHLIGHT_CACHE_MAX });
let highlightCacheTheme: Theme | undefined;

function highlightCached(code: string, validLang: string | undefined, highlightTheme: Theme): string | null {
	if (highlightCacheTheme !== highlightTheme) {
		highlightCache.clear();
		highlightCacheTheme = highlightTheme;
	}
	const key = `${validLang ?? ""}\x00${code}`;
	const hit = highlightCache.get(key);
	if (hit !== undefined) {
		return hit;
	}
	let highlighted: string;
	try {
		highlighted = nativeHighlightCode(code, validLang, getHighlightColors(highlightTheme));
	} catch {
		return null;
	}
	highlightCache.set(key, highlighted);
	return highlighted;
}

/**
 * Highlight code with syntax coloring based on file extension or language.
 * Returns array of highlighted lines.
 */
export function highlightCode(code: string, lang?: string, highlightTheme: Theme = theme): string[] {
	const validLang = lang && nativeSupportsLanguage(lang) ? lang : undefined;
	const highlighted = highlightCached(code, validLang, highlightTheme);
	// Always return a fresh array: callers (e.g. renderCodeCell) push extra lines
	// onto the result, which would corrupt the cached string otherwise.
	return (highlighted ?? code).split("\n");
}

export function getSymbolTheme(): SymbolTheme {
	// Guard against `theme` being undefined (pre-init or cross-module-instance
	// plugin calls). Fall back to the ASCII preset so the returned symbols are
	// usable instead of crashing. See #2998.
	if (typeof theme === "undefined") {
		const box = {
			topLeft: "+",
			topRight: "+",
			bottomLeft: "+",
			bottomRight: "+",
			horizontal: "-",
			vertical: "|",
			cross: "+",
			teeDown: "+",
			teeUp: "+",
			teeLeft: "+",
			teeRight: "+",
		};
		return {
			cursor: ">",
			inputCursor: "|",
			boxRound: box,
			boxSharp: box,
			table: box,
			quoteBorder: "|",
			hrChar: "-",
			colorSwatch: "[]",
			spinnerFrames: ["-", "\\", "|", "/"],
		};
	}
	const preset = theme.getSymbolPreset();

	return {
		cursor: theme.nav.cursor,
		inputCursor: preset === "ascii" ? "|" : "▏",
		boxRound: theme.boxRound,
		boxSharp: theme.boxSharp,
		table: theme.boxSharp,
		quoteBorder: theme.md.quoteBorder,
		hrChar: theme.md.hrChar,
		colorSwatch: theme.md.colorSwatch,
		spinnerFrames: theme.getSpinnerFrames("activity"),
	};
}

let cachedMarkdownTheme: MarkdownTheme | undefined;
let cachedMarkdownThemeRef: Theme | undefined;
let markdownMermaidRendering = true;

export function setMarkdownMermaidRendering(enabled: boolean): void {
	if (markdownMermaidRendering === enabled) return;
	markdownMermaidRendering = enabled;
	cachedMarkdownTheme = undefined;
}

export function getMarkdownTheme(): MarkdownTheme {
	if (cachedMarkdownTheme !== undefined && cachedMarkdownThemeRef === theme) {
		return cachedMarkdownTheme;
	}
	const mermaid = markdownMermaidRendering
		? (() => {
				// Mermaid ASCII diagrams render with the active palette so they read as
				// content rather than raw monochrome. Roles mirror the SVG renderer's
				// mapping; `text`/`muted`/`border`/`borderMuted`/`accent` exist in every theme.
				const mermaidColorMode =
					theme.getColorMode() === "truecolor" ? ("truecolor" as const) : ("ansi256" as const);
				const mermaidTheme = {
					fg: theme.getColorHex("text"),
					border: theme.getColorHex("border"),
					line: theme.getColorHex("muted"),
					arrow: theme.getColorHex("accent"),
					corner: theme.getColorHex("muted"),
					junction: theme.getColorHex("borderMuted"),
				};
				return { mermaidColorMode, mermaidTheme };
			})()
		: undefined;
	const markdownTheme: MarkdownTheme = {
		heading: (text: string) => theme.fg("mdHeading", text),
		link: (text: string) => theme.fg("mdLink", text),
		linkUrl: (text: string) => theme.fg("mdLinkUrl", text),
		code: (text: string) => theme.fg("mdCode", text),
		codeBlock: (text: string) => theme.fg("mdCodeBlock", text),
		codeBlockBorder: (text: string) => theme.fg("mdCodeBlockBorder", text),
		quote: (text: string) => theme.fg("mdQuote", text),
		quoteBorder: (text: string) => theme.fg("mdQuoteBorder", text),
		hr: (text: string) => theme.fg("mdHr", text),
		listBullet: (text: string) => theme.fg("mdListBullet", text),
		bold: (text: string) => theme.bold(text),
		italic: (text: string) => theme.italic(text),
		underline: (text: string) => theme.underline(text),
		strikethrough: (text: string) => chalk.strikethrough(text),
		symbols: getSymbolTheme(),
		resolveMermaidAscii: mermaid
			? (source, maxWidth) =>
					resolveMermaidAscii(source, {
						maxWidth,
						theme: mermaid.mermaidTheme,
						colorMode: mermaid.mermaidColorMode,
					})
			: undefined,
		highlightCode: (code: string, lang?: string): string[] => {
			const validLang = lang && nativeSupportsLanguage(lang) ? lang : undefined;
			const highlighted = highlightCached(code, validLang, theme);
			if (highlighted !== null) return highlighted.split("\n");
			return code.split("\n").map(line => theme.fg("mdCodeBlock", line));
		},
	};
	cachedMarkdownTheme = markdownTheme;
	cachedMarkdownThemeRef = theme;
	return markdownTheme;
}

export function getSelectListTheme(): SelectListTheme {
	// Guard against `theme` being undefined (pre-init or cross-module-instance
	// plugin calls). See #2998.
	if (typeof theme === "undefined") {
		return {
			selectedPrefix: (text: string) => text,
			selectedText: (text: string) => text,
			description: (text: string) => text,
			scrollInfo: (text: string) => text,
			noMatch: (text: string) => text,
			symbols: getSymbolTheme(),
			hovered: (text: string) => text,
		};
	}
	return {
		selectedPrefix: (text: string) => theme.fg("accent", text),
		selectedText: (text: string) => theme.fg("accent", text),
		description: (text: string) => theme.fg("muted", text),
		scrollInfo: (text: string) => theme.fg("muted", text),
		noMatch: (text: string) => theme.fg("muted", text),
		symbols: getSymbolTheme(),
		hovered: (text: string) => theme.bg("selectedBg", text),
	};
}

export function getEditorTheme(): EditorTheme {
	// Guard against `theme` being undefined (pre-init or cross-module-instance
	// plugin calls). See #2998.
	if (typeof theme === "undefined") {
		return {
			borderColor: (text: string) => text,
			selectList: getSelectListTheme(),
			symbols: getSymbolTheme(),
			hintStyle: (text: string) => text,
		};
	}
	return {
		borderColor: (text: string) => theme.fg("borderMuted", text),
		selectList: getSelectListTheme(),
		symbols: getSymbolTheme(),
		hintStyle: (text: string) => theme.fg("dim", text),
	};
}

export function getSettingsListTheme(): SettingsListTheme {
	// Plugins (e.g. pi-rtk-optimizer) may call this before `initTheme()` assigns
	// the global `theme`, or from a separate module instance under npm-global
	// installs where the live binding was never initialized. Fall back to plain
	// text so the call returns a usable (unstyled) theme instead of crashing with
	// "undefined is not an object (evaluating 'theme.fg')". See #2998.
	if (typeof theme === "undefined") {
		return {
			label: (text: string) => text,
			value: (text: string) => text,
			description: (text: string) => text,
			cursor: "> ",
			hint: (text: string) => text,
			heading: (text: string) => text,
			section: (text: string) => text,
			hovered: (text: string) => text,
			layerBadge: (layer: SettingLayerBadge) => {
				switch (layer) {
					case "override":
						return "[O] ";
					case "project":
						return "[P] ";
					case "global":
						return "[G] ";
					default:
						return "    ";
				}
			},
		};
	}
	return {
		label: (text: string, selected: boolean, changed: boolean) =>
			changed ? theme.fg("statusLineGitDirty", text) : selected ? theme.fg("accent", text) : text,
		value: (text: string, selected: boolean, changed: boolean) =>
			changed ? theme.fg("statusLineGitDirty", text) : selected ? theme.fg("accent", text) : theme.fg("muted", text),
		description: (text: string) => theme.fg("dim", text),
		cursor: theme.fg("accent", `${theme.nav.cursor} `),
		hint: (text: string) => theme.fg("dim", text),
		heading: (text: string, dimmed: boolean) =>
			dimmed ? theme.fg("dim", theme.underline(text)) : theme.fg("muted", theme.bold(theme.underline(text))),
		section: (text: string, active: boolean) =>
			active ? theme.fg("accent", theme.bold(text)) : theme.fg("muted", text),
		hovered: (text: string) => theme.bg("selectedBg", text),
		layerBadge: (layer: SettingLayerBadge) => {
			switch (layer) {
				case "override":
					return theme.fg("warning", "[O] ");
				case "project":
					return theme.fg("accent", "[P] ");
				case "global":
					return theme.fg("dim", "[G] ");
				default:
					return "    ";
			}
		},
	};
}
