import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getFinalPlanPath, listSavedPlans, resolveSavedPlan } from "@oh-my-pi/pi-coding-agent/plan-mode/storage";

describe("plan-mode/storage", () => {
	let tmpDir: string;
	let artifactsDir: string;
	let projectDir: string;
	let sessionLocalDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-storage-"));
		artifactsDir = path.join(tmpDir, "artifacts");
		projectDir = path.join(tmpDir, ".omp", "plans");
		sessionLocalDir = path.join(artifactsDir, "local");
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	function makeCtx() {
		return {
			cwd: tmpDir,
			getArtifactsDir: () => artifactsDir,
			getSessionId: () => "test-session",
		};
	}

	// ---------------------------------------------------------------------------
	// getFinalPlanPath
	// ---------------------------------------------------------------------------

	describe("getFinalPlanPath", () => {
		it('returns local:// URL for "session" storage', () => {
			const result = getFinalPlanPath("session", { cwd: tmpDir }, "MY_PLAN.md");
			expect(result).toBe("local://MY_PLAN.md");
		});

		it('returns absolute project path for "project" storage', () => {
			const result = getFinalPlanPath("project", { cwd: tmpDir }, "MY_PLAN.md");
			expect(result).toBe(path.resolve(tmpDir, ".omp", "plans", "MY_PLAN.md"));
		});
	});

	// ---------------------------------------------------------------------------
	// listSavedPlans
	// ---------------------------------------------------------------------------

	describe("listSavedPlans", () => {
		it("enumerates project plans", async () => {
			await fs.mkdir(projectDir, { recursive: true });
			await Bun.write(path.join(projectDir, "MY_PLAN.md"), "content");

			const plans = await listSavedPlans(makeCtx());

			expect(plans).toHaveLength(1);
			expect(plans[0].name).toBe("MY_PLAN");
			expect(plans[0].location).toBe("project");
			expect(plans[0].absolutePath).toBe(path.join(projectDir, "MY_PLAN.md"));
			expect(plans[0].url).toBe(path.join(projectDir, "MY_PLAN.md"));
		});

		it("enumerates session plans", async () => {
			await fs.mkdir(sessionLocalDir, { recursive: true });
			await Bun.write(path.join(sessionLocalDir, "SESSION_PLAN.md"), "content");

			const plans = await listSavedPlans(makeCtx());

			expect(plans).toHaveLength(1);
			expect(plans[0].name).toBe("SESSION_PLAN");
			expect(plans[0].location).toBe("session");
			expect(plans[0].url).toBe("local://SESSION_PLAN.md");
		});

		it("enumerates both project and session plans", async () => {
			await fs.mkdir(projectDir, { recursive: true });
			await fs.mkdir(sessionLocalDir, { recursive: true });
			await Bun.write(path.join(projectDir, "PROJECT_PLAN.md"), "project");
			await Bun.write(path.join(sessionLocalDir, "SESSION_PLAN.md"), "session");

			const plans = await listSavedPlans(makeCtx());

			expect(plans).toHaveLength(2);
			const locations = plans.map(p => p.location).sort();
			expect(locations).toEqual(["project", "session"]);
		});

		it("excludes PLAN.md from session plans", async () => {
			await fs.mkdir(sessionLocalDir, { recursive: true });
			await Bun.write(path.join(sessionLocalDir, "PLAN.md"), "draft");
			await Bun.write(path.join(sessionLocalDir, "SAVED_PLAN.md"), "saved");

			const plans = await listSavedPlans(makeCtx());

			expect(plans).toHaveLength(1);
			expect(plans[0].name).toBe("SAVED_PLAN");
		});

		it("sorts plans by mtime desc", async () => {
			await fs.mkdir(projectDir, { recursive: true });
			await fs.mkdir(sessionLocalDir, { recursive: true });

			const older = new Date("2024-01-01T00:00:00.000Z");
			const newer = new Date("2024-06-01T00:00:00.000Z");

			const oldPath = path.join(projectDir, "OLD_PLAN.md");
			const newPath = path.join(sessionLocalDir, "NEW_PLAN.md");
			await Bun.write(oldPath, "old");
			await Bun.write(newPath, "new");
			await fs.utimes(oldPath, older, older);
			await fs.utimes(newPath, newer, newer);

			const plans = await listSavedPlans(makeCtx());

			expect(plans[0].name).toBe("NEW_PLAN");
			expect(plans[1].name).toBe("OLD_PLAN");
		});

		it("does not throw when project dir does not exist", async () => {
			await fs.mkdir(sessionLocalDir, { recursive: true });
			await Bun.write(path.join(sessionLocalDir, "SESSION_PLAN.md"), "content");

			const plans = await listSavedPlans(makeCtx());

			expect(plans).toHaveLength(1);
			expect(plans[0].location).toBe("session");
		});

		it("returns empty array when both dirs do not exist", async () => {
			const plans = await listSavedPlans(makeCtx());
			expect(plans).toHaveLength(0);
		});
	});

	// ---------------------------------------------------------------------------
	// resolveSavedPlan
	// ---------------------------------------------------------------------------

	describe("resolveSavedPlan", () => {
		it("returns null for empty string", async () => {
			const result = await resolveSavedPlan("", makeCtx());
			expect(result).toBeNull();
		});

		it("returns null for whitespace-only string", async () => {
			const result = await resolveSavedPlan("   ", makeCtx());
			expect(result).toBeNull();
		});

		it("finds plan by bare stem in project", async () => {
			await fs.mkdir(projectDir, { recursive: true });
			await Bun.write(path.join(projectDir, "MY_PLAN.md"), "content");

			const result = await resolveSavedPlan("MY_PLAN", makeCtx());

			expect(result).not.toBeNull();
			expect(result!.name).toBe("MY_PLAN");
			expect(result!.location).toBe("project");
			expect(result!.absolutePath).toBe(path.join(projectDir, "MY_PLAN.md"));
		});

		it("finds plan by bare stem in session when not in project", async () => {
			await fs.mkdir(sessionLocalDir, { recursive: true });
			await Bun.write(path.join(sessionLocalDir, "SESSION_PLAN.md"), "content");

			const result = await resolveSavedPlan("SESSION_PLAN", makeCtx());

			expect(result).not.toBeNull();
			expect(result!.name).toBe("SESSION_PLAN");
			expect(result!.location).toBe("session");
			expect(result!.url).toBe("local://SESSION_PLAN.md");
		});

		it("throws when bare stem is ambiguous (found in both locations)", async () => {
			await fs.mkdir(projectDir, { recursive: true });
			await fs.mkdir(sessionLocalDir, { recursive: true });
			await Bun.write(path.join(projectDir, "COMMON_PLAN.md"), "project");
			await Bun.write(path.join(sessionLocalDir, "COMMON_PLAN.md"), "session");

			await expect(resolveSavedPlan("COMMON_PLAN", makeCtx())).rejects.toThrow(`Ambiguous plan name "COMMON_PLAN"`);
		});

		it("ambiguity error message mentions both project and session", async () => {
			await fs.mkdir(projectDir, { recursive: true });
			await fs.mkdir(sessionLocalDir, { recursive: true });
			await Bun.write(path.join(projectDir, "SHARED.md"), "project");
			await Bun.write(path.join(sessionLocalDir, "SHARED.md"), "session");

			let caught: unknown;
			try {
				await resolveSavedPlan("SHARED", makeCtx());
			} catch (err) {
				caught = err;
			}

			expect(caught).toBeInstanceOf(Error);
			const msg = (caught as Error).message;
			expect(msg).toContain(".omp/plans/SHARED.md");
			expect(msg).toContain("session");
		});

		it("resolves absolute path to existing file", async () => {
			await fs.mkdir(projectDir, { recursive: true });
			const absPath = path.join(projectDir, "ABS_PLAN.md");
			await Bun.write(absPath, "content");

			const result = await resolveSavedPlan(absPath, makeCtx());

			expect(result).not.toBeNull();
			expect(result!.absolutePath).toBe(absPath);
			expect(result!.name).toBe("ABS_PLAN");
		});

		it("returns null for non-existent absolute path", async () => {
			const result = await resolveSavedPlan(path.join(tmpDir, "no", "such", "PLAN.md"), makeCtx());
			expect(result).toBeNull();
		});

		it("resolves local:// URL to session file", async () => {
			await fs.mkdir(sessionLocalDir, { recursive: true });
			await Bun.write(path.join(sessionLocalDir, "URL_PLAN.md"), "content");

			const result = await resolveSavedPlan("local://URL_PLAN.md", makeCtx());

			expect(result).not.toBeNull();
			expect(result!.name).toBe("URL_PLAN");
			expect(result!.location).toBe("session");
			expect(result!.url).toBe("local://URL_PLAN.md");
			expect(result!.absolutePath).toBe(path.join(sessionLocalDir, "URL_PLAN.md"));
		});

		it("returns null for non-existent local:// URL", async () => {
			await fs.mkdir(sessionLocalDir, { recursive: true });

			const result = await resolveSavedPlan("local://MISSING.md", makeCtx());
			expect(result).toBeNull();
		});

		it("returns null for missing plan by bare stem", async () => {
			const result = await resolveSavedPlan("NONEXISTENT_PLAN", makeCtx());
			expect(result).toBeNull();
		});
	});
});
