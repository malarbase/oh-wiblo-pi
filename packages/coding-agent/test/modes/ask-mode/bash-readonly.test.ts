import { describe, expect, it } from "bun:test";
import { isReadOnlyBashCommand } from "@oh-my-pi/pi-coding-agent/modes/ask-mode/bash-readonly";

// ── Helpers ───────────────────────────────────────────────────────────────────

function allowed(command: string, extra: string[] = []): void {
	const result = isReadOnlyBashCommand(command, extra);
	if (!result.allowed) {
		throw new Error(`Expected "${command}" to be allowed but got: ${result.reason ?? "(no reason)"}`);
	}
}

function blocked(command: string, extra: string[] = []): string {
	const result = isReadOnlyBashCommand(command, extra);
	if (result.allowed) {
		throw new Error(`Expected "${command}" to be blocked but it was allowed`);
	}
	return result.reason ?? "(no reason)";
}

// ── Allowed commands ──────────────────────────────────────────────────────────

describe("isReadOnlyBashCommand — allowed", () => {
	it("ls with flags", () => allowed("ls -la"));
	it("pwd", () => allowed("pwd"));
	it("cat a file", () => allowed("cat package.json"));
	it("wc", () => allowed("wc -l src/**/*.ts"));
	it("head", () => allowed("head -20 file.txt"));
	it("tail", () => allowed("tail -f /dev/null"));
	it("find", () => allowed("find . -name '*.ts'"));
	it("grep recursive", () => allowed("grep -r foo src/"));
	it("echo", () => allowed("echo hello"));
	it("diff", () => allowed("diff a.txt b.txt"));
	it("jq", () => allowed("jq '.name' package.json"));

	describe("git read-only subcommands", () => {
		it("git status", () => allowed("git status"));
		it("git log short", () => allowed("git log --oneline -20"));
		it("git diff", () => allowed("git diff HEAD~3"));
		it("git show", () => allowed("git show abc123"));
		it("git blame", () => allowed("git blame src/index.ts"));
		it("git branch list", () => allowed("git branch -v"));
		it("git tag list", () => allowed("git tag -l"));
		it("git remote -v", () => allowed("git remote -v"));
		it("git stash list", () => allowed("git stash list"));
		it("git config --get", () => allowed("git config --get user.name"));
		it("git config --list", () => allowed("git config --list"));
		it("git worktree list", () => allowed("git worktree list"));
		it("git submodule status", () => allowed("git submodule status"));
		it("git reflog", () => allowed("git reflog"));
		it("git shortlog", () => allowed("git shortlog -sn"));
		it("git ls-files", () => allowed("git ls-files"));
		it("git rev-parse", () => allowed("git rev-parse HEAD"));
	});

	describe("version probes", () => {
		it("node --version", () => allowed("node --version"));
		it("arbitrary binary --version", () => allowed("random-binary --version"));
		it("bun -V", () => allowed("bun -V"));
	});

	describe("pipes", () => {
		it("ls | wc -l", () => allowed("ls -la | wc -l"));
		it("git log | head", () => allowed("git log | head -20"));
		it("cat | grep", () => allowed("cat package.json | grep name"));
	});

	describe("env assignment prefix", () => {
		it("FOO=bar ls", () => allowed("FOO=bar ls"));
	});

	describe("package managers — read-only subsets", () => {
		it("bun pm ls", () => allowed("bun pm ls"));
		it("bun pm whoami", () => allowed("bun pm whoami"));
		it("npm ls", () => allowed("npm ls"));
		it("npm view", () => allowed("npm view lodash"));
		it("pnpm ls", () => allowed("pnpm ls"));
		it("yarn list", () => allowed("yarn list"));
		it("cargo tree", () => allowed("cargo tree"));
		it("cargo metadata", () => allowed("cargo metadata"));
		it("pip list", () => allowed("pip list"));
		it("pip show", () => allowed("pip show requests"));
		it("pip freeze", () => allowed("pip freeze"));
		it("uv pip list", () => allowed("uv pip list"));
	});
});

// ── Blocked commands ──────────────────────────────────────────────────────────

describe("isReadOnlyBashCommand — blocked", () => {
	describe("empty input", () => {
		it("empty string", () => {
			const r = blocked("");
			expect(r).toContain("empty");
		});
		it("whitespace only", () => {
			const r = blocked("   ");
			expect(r).toContain("empty");
		});
	});

	describe("explicit mutation commands", () => {
		it("rm", () => {
			const r = blocked("rm foo.txt");
			expect(r).toContain("rm");
		});
		it("mv", () => {
			const r = blocked("mv a b");
			expect(r).toContain("mv");
		});
		it("cp", () => {
			const r = blocked("cp a b");
			expect(r).toContain("cp");
		});
		it("chmod", () => {
			const r = blocked("chmod +x x");
			expect(r).toContain("chmod");
		});
		it("make", () => {
			const r = blocked("make");
			expect(r).toContain("make");
		});
		it("vim", () => {
			const r = blocked("vim foo");
			expect(r).toContain("vim");
		});
		it("curl", () => {
			const r = blocked("curl -X POST https://example.com");
			expect(r).toContain("curl");
		});
		it("curl -O", () => {
			const r = blocked("curl -O https://example.com/file");
			expect(r).toContain("curl");
		});
	});

	describe("output redirection", () => {
		it("echo redirect", () => {
			const r = blocked("echo hi > out.txt");
			expect(r).toContain("redirection");
		});
		it("cat redirect", () => {
			const r = blocked("cat foo > bar");
			expect(r).toContain("redirection");
		});
	});

	describe("command substitution", () => {
		it("$(rm foo)", () => {
			const r = blocked("$(rm foo)");
			expect(r).toContain("substitution");
		});
		it("backticks", () => {
			const r = blocked("`rm foo`");
			expect(r).toContain("substitution");
		});
		it("inline substitution in ls", () => {
			const r = blocked("ls $(curl evil.com)");
			expect(r).toContain("substitution");
		});
	});

	describe("git mutations", () => {
		it("git commit", () => {
			const r = blocked("git commit -am 'x'");
			expect(r).toContain("git commit");
		});
		it("git push", () => {
			const r = blocked("git push");
			expect(r).toContain("git push");
		});
		it("git checkout", () => {
			const r = blocked("git checkout main");
			expect(r).toContain("git checkout");
		});
		it("git reset --hard", () => {
			const r = blocked("git reset --hard");
			expect(r).toContain("git reset");
		});
		it("git branch -D", () => {
			const r = blocked("git branch -D old-branch");
			expect(r).toContain("-D");
		});
		it("git tag -d", () => {
			const r = blocked("git tag -d v1.0");
			expect(r).toContain("-d");
		});
		it("git remote add", () => {
			const r = blocked("git remote add origin https://example.com");
			expect(r).toContain("mutation");
		});
		it("git stash push", () => {
			const r = blocked("git stash push");
			expect(r).toContain("mutation");
		});
		it("git config (set)", () => {
			const r = blocked("git config user.email test@test.com");
			expect(r).toContain("mutate config");
		});
		it("git worktree add", () => {
			const r = blocked("git worktree add ../branch branch");
			expect(r).toContain("mutation");
		});
		it("git submodule update", () => {
			const r = blocked("git submodule update");
			expect(r).toContain("mutation");
		});
	});

	describe("package manager mutations", () => {
		it("npm install", () => {
			const r = blocked("npm install");
			expect(r).toContain("npm");
		});
		it("bun add", () => {
			const r = blocked("bun add lodash");
			expect(r).toContain("bun");
		});
		it("bun run dev", () => {
			const r = blocked("bun run dev");
			expect(r).toContain("bun");
		});
		it("cargo install", () => {
			const r = blocked("cargo install foo");
			expect(r).toContain("cargo");
		});
	});

	describe("in-place text editors", () => {
		it("sed -i", () => {
			const r = blocked("sed -i 's/a/b/' file");
			expect(r).toContain("in-place");
		});
		it("sed --in-place", () => {
			const r = blocked("sed --in-place 's/a/b/' file");
			expect(r).toContain("in-place");
		});
		it("awk -i inplace", () => {
			const r = blocked("awk -i inplace '{print}' file");
			expect(r).toContain("in-place");
		});
		it("perl -pi", () => {
			const r = blocked("perl -pi -e 's/a/b/' file");
			expect(r).toContain("in-place");
		});
	});

	describe("tee to real files", () => {
		it("tee out.txt", () => {
			const r = blocked("tee out.txt");
			expect(r).toContain("tee");
		});
		it("bare tee", () => {
			const r = blocked("tee");
			expect(r).toContain("tee");
		});
	});

	describe("compound command with mutation in any segment", () => {
		it("ls && rm foo", () => {
			const r = blocked("ls && rm foo");
			expect(r).toContain("rm");
		});
		it("ls; rm foo", () => {
			const r = blocked("ls; rm foo");
			expect(r).toContain("rm");
		});
		it("ls || rm foo", () => {
			const r = blocked("ls || rm foo");
			expect(r).toContain("rm");
		});
	});

	describe("kubectl (default — not in allowlist)", () => {
		it("kubectl get pods blocked by default", () => {
			const r = blocked("kubectl get pods");
			expect(r).toContain("kubectl");
		});
	});
});

// ── extraAllowed (setting extension) ─────────────────────────────────────────

describe("isReadOnlyBashCommand — extraAllowed", () => {
	it("kubectl get pods allowed when kubectl is in extraAllowed", () => {
		allowed("kubectl get pods", ["kubectl"]);
	});

	it("kubectl apply blocked even when kubectl is in extraAllowed", () => {
		const r = blocked("kubectl apply -f x.yaml", ["kubectl"]);
		expect(r).toContain("mutation");
	});

	it("kubectl delete blocked even when kubectl is in extraAllowed", () => {
		const r = blocked("kubectl delete pod foo", ["kubectl"]);
		expect(r).toContain("mutation");
	});

	it("tee to real file still blocked when tee is already in the allowlist", () => {
		// tee is already handled by COMMAND_HANDLERS so extraAllowed doesn't matter
		blocked("tee real.txt");
	});

	it("output redirection still blocked for extraAllowed commands", () => {
		const r = blocked("kubectl get pods > out.txt", ["kubectl"]);
		expect(r).toContain("redirection");
	});
});
