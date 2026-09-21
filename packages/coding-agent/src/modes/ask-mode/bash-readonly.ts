/**
 * Ask-mode read-only bash classifier.
 *
 * Determines whether a bash command string is safe to execute when ask mode is
 * active. Uses an allowlist-first approach (fail-closed): anything that cannot
 * be proven read-only is rejected with a reason string.
 *
 * The classifier is a pure function — no I/O, no settings access.
 */

// ── Public types ─────────────────────────────────────────────────────────────

export interface ReadOnlyCheck {
	allowed: boolean;
	reason?: string;
}

// ── Split pattern ─────────────────────────────────────────────────────────────

/**
 * Splits a command string into segments on shell control operators.
 * `||` is matched before `|` so it is consumed as a single operator and does
 * not produce a spurious extra split.
 */
const SHELL_SPLIT_RE = /\|\||&&|[|;&\n]/;

// ── Per-segment deny patterns ─────────────────────────────────────────────────

interface DenyPattern {
	re: RegExp;
	label: string;
}

/**
 * These patterns are checked against the raw segment text.  Any match blocks
 * the segment immediately, before command-allowlist lookup.
 */
const SEGMENT_DENY_PATTERNS: DenyPattern[] = [
	{ re: />/, label: "output redirection" },
	{ re: /\$\(/, label: "command substitution" },
	{ re: /`/, label: "backtick substitution" },
	{ re: /<\(/, label: "process substitution" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip leading `VAR=value ` env-assignment tokens (simple unquoted values). */
const ENV_ASSIGN_PREFIX_RE = /^(\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/;

function stripEnvAssignments(segment: string): string {
	return segment.replace(ENV_ASSIGN_PREFIX_RE, "").trimStart();
}

/** Split a segment into whitespace-delimited tokens (no quote awareness). */
function tokenize(s: string): string[] {
	return s.trim().split(/\s+/).filter(Boolean);
}

// ── Git subcommand checker ────────────────────────────────────────────────────

/** A checker receives the tokens that appear *after* the subcommand. */
type SubcmdChecker = (subcmdArgs: string[]) => ReadOnlyCheck;

/**
 * Allowed git subcommands.  `"allow"` means unconditionally allowed;
 * a function receives the tokens after the subcommand for secondary checks.
 */
const GIT_ALLOWED: ReadonlyMap<string, "allow" | SubcmdChecker> = new Map<string, "allow" | SubcmdChecker>([
	["status", "allow"],
	["log", "allow"],
	["diff", "allow"],
	["show", "allow"],
	["blame", "allow"],
	["describe", "allow"],
	["rev-parse", "allow"],
	["rev-list", "allow"],
	["ls-files", "allow"],
	["ls-tree", "allow"],
	["cat-file", "allow"],
	["grep", "allow"],
	["shortlog", "allow"],
	["reflog", "allow"],
	[
		"branch",
		args => {
			const MUTATION_FLAGS = new Set(["-D", "-d", "--delete", "-m", "-M", "--move", "-c", "-C", "--copy"]);
			const blocked = args.find(a => MUTATION_FLAGS.has(a));
			if (blocked) return { allowed: false, reason: `git branch ${blocked} is a mutation` };
			return { allowed: true };
		},
	],
	[
		"tag",
		args => {
			const MUTATION_FLAGS = new Set(["-d", "--delete"]);
			const blocked = args.find(a => MUTATION_FLAGS.has(a));
			if (blocked) return { allowed: false, reason: `git tag ${blocked} is a mutation` };
			return { allowed: true };
		},
	],
	[
		"remote",
		args => {
			const MUTATION_SUBS = new Set(["add", "remove", "rm", "set-url", "rename"]);
			const sub = args.find(a => !a.startsWith("-"));
			if (sub && MUTATION_SUBS.has(sub)) {
				return { allowed: false, reason: `git remote ${sub} is a mutation` };
			}
			return { allowed: true };
		},
	],
	[
		"stash",
		args => {
			const sub = args.find(a => !a.startsWith("-"));
			if (!sub || sub === "list") return { allowed: true };
			return { allowed: false, reason: `git stash ${sub} is a mutation` };
		},
	],
	[
		"config",
		args => {
			if (
				args.includes("--get") ||
				args.includes("--get-all") ||
				args.includes("--get-regexp") ||
				args.includes("--list") ||
				args.includes("-l")
			) {
				return { allowed: true };
			}
			return { allowed: false, reason: "git config without --get or --list may mutate config" };
		},
	],
	[
		"worktree",
		args => {
			const sub = args.find(a => !a.startsWith("-"));
			if (!sub || sub === "list") return { allowed: true };
			return { allowed: false, reason: `git worktree ${sub} is a mutation` };
		},
	],
	[
		"submodule",
		args => {
			const sub = args.find(a => !a.startsWith("-"));
			if (!sub || sub === "status" || sub === "summary") return { allowed: true };
			return { allowed: false, reason: `git submodule ${sub} is a mutation` };
		},
	],
]);

function checkGit(tokens: string[]): ReadOnlyCheck {
	// tokens[0] = "git"; everything after is args.
	const args = tokens.slice(1);
	const subcmdIdx = args.findIndex(a => !a.startsWith("-"));
	if (subcmdIdx < 0) {
		return { allowed: false, reason: "git command missing subcommand" };
	}
	const subcmd = args[subcmdIdx]!;
	const subcmdArgs = args.slice(subcmdIdx + 1);
	const entry = GIT_ALLOWED.get(subcmd);
	if (!entry) {
		return { allowed: false, reason: `git ${subcmd} is not in the read-only allowlist` };
	}
	if (entry === "allow") return { allowed: true };
	return entry(subcmdArgs);
}

// ── Sed / Awk / Perl ─────────────────────────────────────────────────────────

function checkSed(tokens: string[]): ReadOnlyCheck {
	const args = tokens.slice(1);
	// -i alone, --in-place, or -i<suffix> (e.g. -i.bak)
	const hasInPlace = args.some(a => a === "-i" || a === "--in-place" || /^-i./.test(a));
	if (hasInPlace) {
		return { allowed: false, reason: "sed -i / --in-place edits files in-place" };
	}
	return { allowed: true };
}

function checkAwk(tokens: string[]): ReadOnlyCheck {
	const args = tokens.slice(1);
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "-i" && args[i + 1] === "inplace") {
			return { allowed: false, reason: "awk -i inplace edits files in-place" };
		}
	}
	return { allowed: true };
}

function checkPerl(tokens: string[]): ReadOnlyCheck {
	const args = tokens.slice(1);
	// Matches -i, -pi, -ni, -i.bak and similar combined short-flag forms
	const hasInPlace = args.some(a => !a.startsWith("--") && /^-[a-zA-Z]*i/.test(a));
	if (hasInPlace) {
		return { allowed: false, reason: "perl -i edits files in-place" };
	}
	return { allowed: true };
}

// ── Tee ──────────────────────────────────────────────────────────────────────

const TEE_SAFE_TARGETS = new Set(["/dev/null", "/dev/stderr", "/dev/fd/2"]);

function checkTee(tokens: string[]): ReadOnlyCheck {
	// Strip flags (e.g. -a), keep only the file-path arguments
	const fileArgs = tokens.slice(1).filter(a => !a.startsWith("-"));
	if (fileArgs.length === 0) {
		return {
			allowed: false,
			reason: "bare tee is interactive; use tee /dev/null to discard output",
		};
	}
	if (fileArgs.every(a => TEE_SAFE_TARGETS.has(a))) {
		return { allowed: true };
	}
	return {
		allowed: false,
		reason: "tee writes to files; only tee /dev/null or /dev/stderr is allowed in read-only mode",
	};
}

// ── Top / Htop / Ip ──────────────────────────────────────────────────────────

function checkTop(tokens: string[]): ReadOnlyCheck {
	const args = tokens.slice(1);
	if (args.includes("-b") && args.includes("-n")) {
		return { allowed: true };
	}
	return { allowed: false, reason: "top is interactive; use top -b -n 1 for batch output" };
}

const IP_SAFE_OBJECTS = new Set(["addr", "address", "route", "link"]);
const IP_SAFE_VERBS = new Set(["show", "list", "ls"]);

function checkIp(tokens: string[]): ReadOnlyCheck {
	const args = tokens.slice(1);
	const obj = args.find(a => !a.startsWith("-"));
	if (!obj || !IP_SAFE_OBJECTS.has(obj)) {
		return { allowed: false, reason: "only ip addr/route/link show is allowed in read-only mode" };
	}
	const objIdx = args.indexOf(obj);
	const verb = args.slice(objIdx + 1).find(a => !a.startsWith("-"));
	if (!verb || IP_SAFE_VERBS.has(verb)) return { allowed: true };
	return { allowed: false, reason: `ip ${obj} ${verb} is a mutation` };
}

// ── Package managers ──────────────────────────────────────────────────────────

function checkBun(tokens: string[]): ReadOnlyCheck {
	const args = tokens.slice(1);
	const subcmd = args.find(a => !a.startsWith("-"));
	if (!subcmd) return { allowed: false, reason: "bun command has no subcommand" };
	if (subcmd === "pm") {
		const pmIdx = args.indexOf("pm");
		const sub2 = args.slice(pmIdx + 1).find(a => !a.startsWith("-"));
		if (sub2 === "ls" || sub2 === "whoami") return { allowed: true };
		return { allowed: false, reason: `bun pm ${sub2 ?? ""} is not in the read-only allowlist` };
	}
	return { allowed: false, reason: `bun ${subcmd} is not in the read-only allowlist` };
}

const NPM_READONLY = new Set(["ls", "list", "view", "info", "show"]);

function checkNpm(tokens: string[]): ReadOnlyCheck {
	const args = tokens.slice(1);
	const subcmd = args.find(a => !a.startsWith("-"));
	if (subcmd && NPM_READONLY.has(subcmd)) return { allowed: true };
	return { allowed: false, reason: `npm ${subcmd ?? ""} is not in the read-only allowlist` };
}

function checkPnpm(tokens: string[]): ReadOnlyCheck {
	const args = tokens.slice(1);
	const subcmd = args.find(a => !a.startsWith("-"));
	if (subcmd === "ls" || subcmd === "list") return { allowed: true };
	return { allowed: false, reason: `pnpm ${subcmd ?? ""} is not in the read-only allowlist` };
}

function checkYarn(tokens: string[]): ReadOnlyCheck {
	const args = tokens.slice(1);
	const subcmd = args.find(a => !a.startsWith("-"));
	if (subcmd === "list") return { allowed: true };
	return { allowed: false, reason: `yarn ${subcmd ?? ""} is not in the read-only allowlist` };
}

const CARGO_READONLY = new Set(["metadata", "tree", "pkgid"]);

function checkCargo(tokens: string[]): ReadOnlyCheck {
	const args = tokens.slice(1);
	const subcmd = args.find(a => !a.startsWith("-"));
	if (subcmd && CARGO_READONLY.has(subcmd)) return { allowed: true };
	return { allowed: false, reason: `cargo ${subcmd ?? ""} is not in the read-only allowlist` };
}

const PIP_READONLY = new Set(["list", "show", "freeze"]);

function checkPip(tokens: string[]): ReadOnlyCheck {
	const args = tokens.slice(1);
	const subcmd = args.find(a => !a.startsWith("-"));
	if (subcmd && PIP_READONLY.has(subcmd)) return { allowed: true };
	return { allowed: false, reason: `pip ${subcmd ?? ""} is not in the read-only allowlist` };
}

function checkUv(tokens: string[]): ReadOnlyCheck {
	const args = tokens.slice(1);
	const subcmd = args.find(a => !a.startsWith("-"));
	if (subcmd === "pip") {
		const pipIdx = args.indexOf("pip");
		const sub2 = args.slice(pipIdx + 1).find(a => !a.startsWith("-"));
		if (sub2 === "list" || sub2 === "show" || sub2 === "freeze") return { allowed: true };
		return { allowed: false, reason: `uv pip ${sub2 ?? ""} is not in the read-only allowlist` };
	}
	return { allowed: false, reason: `uv ${subcmd ?? ""} is not in the read-only allowlist` };
}

// ── Main command handler map ──────────────────────────────────────────────────

type CmdHandler = "allow" | ((tokens: string[]) => ReadOnlyCheck);

/**
 * Top-level command allowlist.  Keys are the base command name (no path prefix).
 * `"allow"` means all invocations are safe; a function performs secondary checks.
 * Commands absent from this map are blocked by default (fail-closed).
 */
const COMMAND_HANDLERS = new Map<string, CmdHandler>([
	// File inspection
	["ls", "allow"],
	["ll", "allow"],
	["pwd", "allow"],
	["cat", "allow"],
	["head", "allow"],
	["tail", "allow"],
	["wc", "allow"],
	["file", "allow"],
	["stat", "allow"],
	["du", "allow"],
	["df", "allow"],
	["tree", "allow"],
	["realpath", "allow"],
	["readlink", "allow"],
	["basename", "allow"],
	["dirname", "allow"],
	// Search
	["grep", "allow"],
	["rg", "allow"],
	["ripgrep", "allow"],
	["ag", "allow"],
	["ack", "allow"],
	["find", "allow"],
	["fd", "allow"],
	["locate", "allow"],
	// Text processing (some have secondary checks for in-place flags)
	["sed", checkSed],
	["awk", checkAwk],
	["perl", checkPerl],
	["cut", "allow"],
	["sort", "allow"],
	["uniq", "allow"],
	["tr", "allow"],
	["column", "allow"],
	["paste", "allow"],
	["join", "allow"],
	["nl", "allow"],
	["rev", "allow"],
	["tac", "allow"],
	["fold", "allow"],
	["expand", "allow"],
	["unexpand", "allow"],
	["comm", "allow"],
	["diff", "allow"],
	["cmp", "allow"],
	["xxd", "allow"],
	["hexdump", "allow"],
	["od", "allow"],
	["strings", "allow"],
	["jq", "allow"],
	["yq", "allow"],
	["tee", checkTee],
	// Identity / environment
	["whoami", "allow"],
	["id", "allow"],
	["groups", "allow"],
	["hostname", "allow"],
	["uname", "allow"],
	["env", "allow"],
	["printenv", "allow"],
	["locale", "allow"],
	["date", "allow"],
	["cal", "allow"],
	["uptime", "allow"],
	["tty", "allow"],
	// Binary lookup
	["which", "allow"],
	["whereis", "allow"],
	["type", "allow"],
	["command", "allow"],
	// Process inspection
	["ps", "allow"],
	["pgrep", "allow"],
	["top", checkTop],
	["lsof", "allow"],
	["netstat", "allow"],
	["ss", "allow"],
	["ip", checkIp],
	// Echo / print
	["echo", "allow"],
	["printf", "allow"],
	// Git
	["git", checkGit],
	// Package managers — read-only subsets only
	["bun", checkBun],
	["npm", checkNpm],
	["pnpm", checkPnpm],
	["yarn", checkYarn],
	["cargo", checkCargo],
	["pip", checkPip],
	["pip3", checkPip],
	["uv", checkUv],
]);

// ── Extra-allowed mutation guard ──────────────────────────────────────────────

/**
 * Commands in `extraAllowed` (user config) still have known mutation
 * subcommands blocked.  This prevents `kubectl apply` from slipping through
 * just because "kubectl" was added to the extra allowlist.
 */
const EXTRA_ALLOWED_MUTATION_SUBS = new Map<string, ReadonlySet<string>>([
	[
		"kubectl",
		new Set([
			"apply",
			"create",
			"delete",
			"replace",
			"edit",
			"patch",
			"scale",
			"rollout",
			"exec",
			"cp",
			"port-forward",
			"run",
		]),
	],
]);

// ── Per-segment check ─────────────────────────────────────────────────────────

function checkSegment(segment: string, extraAllowed: string[]): ReadOnlyCheck {
	// 1. Deny dangerous constructs anywhere in the raw segment text
	for (const { re, label } of SEGMENT_DENY_PATTERNS) {
		if (re.test(segment)) {
			return { allowed: false, reason: `segment contains ${label}` };
		}
	}

	// 2. Strip leading env-var assignments and tokenize
	const stripped = stripEnvAssignments(segment);
	const tokens = tokenize(stripped);

	if (tokens.length === 0) {
		return { allowed: false, reason: "empty segment after stripping env assignments" };
	}

	const rawCmd = tokens[0]!;
	// Strip absolute-path prefix so /usr/bin/grep is treated as grep
	const cmd = rawCmd.includes("/") ? (rawCmd.split("/").pop() ?? rawCmd) : rawCmd;

	// 3. Version/help probe: `any-binary --version` or `any-binary -V` is safe
	const lastToken = tokens.at(-1);
	if (lastToken === "--version" || lastToken === "-V") {
		return { allowed: true };
	}

	// 4. Look up command in the allowlist
	const handler = COMMAND_HANDLERS.get(cmd);
	if (handler !== undefined) {
		if (handler === "allow") return { allowed: true };
		return handler(tokens);
	}

	// 5. User-configured extra allowlist (still subject to known-mutation guard)
	if (extraAllowed.includes(cmd)) {
		const mutationSubs = EXTRA_ALLOWED_MUTATION_SUBS.get(cmd);
		if (mutationSubs) {
			const sub = tokens.slice(1).find(t => !t.startsWith("-"));
			if (sub && mutationSubs.has(sub)) {
				return { allowed: false, reason: `${cmd} ${sub} is a mutation command` };
			}
		}
		return { allowed: true };
	}

	return { allowed: false, reason: `${cmd} is not in the read-only allowlist` };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check whether a bash command string is safe to execute in ask (read-only)
 * mode.  The command is split on shell control operators and every resulting
 * segment must pass independently (fail-closed).
 *
 * @param command      Raw command string as passed to the bash tool.
 * @param extraAllowed Additional base-command tokens allowed by user config.
 *                     They still cannot use output redirection or known
 *                     mutation subcommands.
 */
export function isReadOnlyBashCommand(command: string, extraAllowed: string[] = []): ReadOnlyCheck {
	if (!command.trim()) {
		return { allowed: false, reason: "empty command" };
	}

	const segments = command
		.split(SHELL_SPLIT_RE)
		.map(s => s.trim())
		.filter(Boolean);
	if (segments.length === 0) {
		return { allowed: false, reason: "empty command" };
	}

	for (const segment of segments) {
		const check = checkSegment(segment, extraAllowed);
		if (!check.allowed) return check;
	}

	return { allowed: true };
}
