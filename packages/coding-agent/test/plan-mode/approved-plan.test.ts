import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	humanizePlanTitle,
	normalizePlanTitle,
	planFileUrlForSlug,
	renameApprovedPlanFile,
	resolveApprovedPlan,
} from "@oh-my-pi/pi-coding-agent/plan-mode/approved-plan";
import { normalizeLocalScheme } from "@oh-my-pi/pi-coding-agent/tools/path-utils";

describe("planFileUrlForSlug", () => {
	it("maps a slug to its local plan URL", () => {
		expect(planFileUrlForSlug("auth-refactor")).toBe("local://auth-refactor-plan.md");
	});
});

describe("resolveApprovedPlan", () => {
	/** A `readPlan` backed by an in-memory map of `local://` URL → content. */
	function reader(files: Record<string, string>) {
		return async (url: string) => (url in files ? files[url] : null);
	}

	it("locates the plan from the supplied title's slug — no rename", async () => {
		const result = await resolveApprovedPlan({
			suppliedTitle: "auth-refactor",
			statePlanFilePath: "local://PLAN.md",
			readPlan: reader({ "local://auth-refactor-plan.md": "# Auth refactor\n\nbody" }),
		});
		expect(result.planFilePath).toBe("local://auth-refactor-plan.md");
		expect(result.planContent).toContain("body");
		expect(result.title).toBe("auth-refactor");
	});

	it("strips a trailing -plan from the supplied title before reconstructing the file", async () => {
		const result = await resolveApprovedPlan({
			suppliedTitle: "auth-plan",
			statePlanFilePath: "local://PLAN.md",
			readPlan: reader({ "local://auth-plan.md": "# Auth\n\nbody" }),
		});
		expect(result.planFilePath).toBe("local://auth-plan.md");
	});

	it("falls back to the plan-mode state path when the slug file is absent", async () => {
		const result = await resolveApprovedPlan({
			suppliedTitle: "mismatch",
			statePlanFilePath: "local://existing-plan.md",
			readPlan: reader({ "local://existing-plan.md": "# Existing\n\nbody" }),
		});
		expect(result.planFilePath).toBe("local://existing-plan.md");
	});

	it("prefers the newest listed plan over a completed state plan", async () => {
		const result = await resolveApprovedPlan({
			suppliedTitle: "Different title",
			statePlanFilePath: "local://completed-plan.md",
			readPlan: reader({
				"local://completed-plan.md": "# Completed\n\nOld plan",
				"local://new-draft-plan.md": "# New\n\nNew plan",
			}),
			listPlanFiles: async () => ["local://new-draft-plan.md", "local://completed-plan.md"],
		});
		expect(result.planFilePath).toBe("local://new-draft-plan.md");
		expect(result.planContent).toContain("New plan");
	});

	it("treats a single-slash state URL as in-scan and prefers the newer draft", async () => {
		const canonical = (files: Record<string, string>) => {
			const map: Record<string, string> = {};
			for (const url in files) map[normalizeLocalScheme(url)] = files[url];
			return async (url: string) => map[normalizeLocalScheme(url)] ?? null;
		};
		const result = await resolveApprovedPlan({
			suppliedTitle: undefined,
			statePlanFilePath: "local:/completed-plan.md",
			readPlan: canonical({
				"local://completed-plan.md": "# Completed\n\nOld plan",
				"local://new-draft-plan.md": "# New\n\nNew plan",
			}),
			listPlanFiles: async () => ["local://new-draft-plan.md", "local://completed-plan.md"],
		});
		expect(result.planFilePath).toBe("local://new-draft-plan.md");
		expect(result.planContent).toContain("New plan");
	});

	it("keeps a state plan the scan can't see ahead of older scanned artifacts", async () => {
		const result = await resolveApprovedPlan({
			suppliedTitle: undefined,
			statePlanFilePath: "docs/CURRENT.md",
			readPlan: reader({
				"docs/CURRENT.md": "# Current\n\nCurrent plan",
				"local://old-artifact-plan.md": "# Old\n\nOld plan",
			}),
			listPlanFiles: async () => ["local://old-artifact-plan.md"],
		});
		expect(result.planFilePath).toBe("docs/CURRENT.md");
		expect(result.planContent).toContain("Current plan");
	});

	it("scans listed plan files when the title was dropped and state path is empty", async () => {
		const result = await resolveApprovedPlan({
			suppliedTitle: undefined,
			statePlanFilePath: "local://PLAN.md",
			readPlan: reader({ "local://discovered-plan.md": "# Discovered\n\nbody" }),
			listPlanFiles: async () => ["local://discovered-plan.md"],
		});
		expect(result.planFilePath).toBe("local://discovered-plan.md");
	});

	it("throws an actionable error when no plan file exists", async () => {
		await expect(
			resolveApprovedPlan({
				suppliedTitle: "ghost",
				statePlanFilePath: "local://PLAN.md",
				readPlan: reader({}),
			}),
		).rejects.toThrow("Plan file not found at local://ghost-plan.md");
	});
});

describe("humanizePlanTitle", () => {
	it("replaces separators with spaces and capitalizes", () => {
		expect(humanizePlanTitle("migrate-mcp-loader")).toBe("Migrate mcp loader");
		expect(humanizePlanTitle("fix_session_naming")).toBe("Fix session naming");
		expect(humanizePlanTitle("RefactorRouter")).toBe("RefactorRouter");
	});

	it("collapses runs of separators", () => {
		expect(humanizePlanTitle("foo--bar__baz")).toBe("Foo bar baz");
	});

	it("returns empty string for blank-ish input", () => {
		expect(humanizePlanTitle("")).toBe("");
		expect(humanizePlanTitle("---")).toBe("");
	});
});

describe("normalizePlanTitle", () => {
	it("accepts a clean identifier as-is", () => {
		expect(normalizePlanTitle("my-plan")).toEqual({ title: "my-plan", fileName: "my-plan.md" });
		expect(normalizePlanTitle("feature_branch")).toEqual({ title: "feature_branch", fileName: "feature_branch.md" });
	});

	it("strips a trailing .md suffix provided by the model", () => {
		expect(normalizePlanTitle("my-plan.md")).toEqual({ title: "my-plan", fileName: "my-plan.md" });
	});
});

describe("renameApprovedPlanFile", () => {
	let tmpDir: string;
	let artifactsLocalDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "approved-plan-"));
		artifactsLocalDir = path.join(tmpDir, "artifacts", "local");
		await fs.mkdir(artifactsLocalDir, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	function makeOptions(extra?: object) {
		return {
			getArtifactsDir: () => path.join(tmpDir, "artifacts"),
			getSessionId: () => "test-session",
			...extra,
		};
	}

	it("destination-exists guard: throws without overwrite flag", async () => {
		const srcPath = path.join(artifactsLocalDir, "PLAN.md");
		const dstPath = path.join(tmpDir, ".omp", "plans", "MY_PLAN.md");
		await fs.mkdir(path.dirname(dstPath), { recursive: true });
		await Bun.write(srcPath, "# Source plan");
		await Bun.write(dstPath, "# Existing plan");

		await expect(
			renameApprovedPlanFile({
				planFilePath: "local://PLAN.md",
				finalPlanFilePath: dstPath,
				...makeOptions(),
			}),
		).rejects.toThrow("Plan destination already exists");

		await expect(Bun.file(srcPath).text()).resolves.toBe("# Source plan");
		await expect(Bun.file(dstPath).text()).resolves.toBe("# Existing plan");
	});

	it("overwrite: true skips the guard and overwrites destination", async () => {
		const srcPath = path.join(artifactsLocalDir, "PLAN.md");
		const dstPath = path.join(tmpDir, ".omp", "plans", "MY_PLAN.md");
		await fs.mkdir(path.dirname(dstPath), { recursive: true });
		await Bun.write(srcPath, "# Updated plan");
		await Bun.write(dstPath, "# Old plan");

		await renameApprovedPlanFile({
			planFilePath: "local://PLAN.md",
			finalPlanFilePath: dstPath,
			...makeOptions(),
			overwrite: true,
		});

		await expect(Bun.file(dstPath).text()).resolves.toBe("# Updated plan");
		await expect(Bun.file(srcPath).exists()).resolves.toBe(false);
	});

	it("no-op when source === destination (resolved paths are equal)", async () => {
		const planPath = path.join(artifactsLocalDir, "PLAN.md");
		await Bun.write(planPath, "# content");

		await expect(
			renameApprovedPlanFile({
				planFilePath: "local://PLAN.md",
				finalPlanFilePath: "local://PLAN.md",
				...makeOptions(),
			}),
		).resolves.toBeUndefined();

		await expect(Bun.file(planPath).text()).resolves.toBe("# content");
	});

	it("EXDEV cross-device fallback: copyFile+unlink used when rename throws EXDEV", async () => {
		const srcPath = path.join(artifactsLocalDir, "PLAN.md");
		const dstPath = path.join(tmpDir, ".omp", "plans", "MY_PLAN.md");
		await fs.mkdir(path.dirname(dstPath), { recursive: true });
		await Bun.write(srcPath, "# Cross-device plan");

		const exdevError = Object.assign(new Error("cross-device link not permitted"), { code: "EXDEV" });
		const renameSpy = spyOn(fs, "rename").mockRejectedValueOnce(exdevError);

		await renameApprovedPlanFile({
			planFilePath: "local://PLAN.md",
			finalPlanFilePath: dstPath,
			...makeOptions(),
		});

		renameSpy.mockRestore();

		await expect(Bun.file(dstPath).text()).resolves.toBe("# Cross-device plan");
		await expect(Bun.file(srcPath).exists()).resolves.toBe(false);
	});
});
