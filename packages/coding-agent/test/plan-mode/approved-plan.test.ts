import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { renameApprovedPlanFile } from "@oh-my-pi/pi-coding-agent/plan-mode/approved-plan";

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

		// source must still exist — the guard aborted before rename
		await expect(Bun.file(srcPath).text()).resolves.toBe("# Source plan");
		// destination must be unchanged
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

		// destination must have the new content
		await expect(Bun.file(dstPath).text()).resolves.toBe("# Updated plan");
		// source must be gone (rename consumed it)
		await expect(Bun.file(srcPath).exists()).resolves.toBe(false);
	});

	it("no-op when source === destination (resolved paths are equal)", async () => {
		const planPath = path.join(artifactsLocalDir, "PLAN.md");
		await Bun.write(planPath, "# content");

		// Both planFilePath and finalPlanFilePath resolve to the same absolute path.
		await expect(
			renameApprovedPlanFile({
				planFilePath: "local://PLAN.md",
				finalPlanFilePath: "local://PLAN.md",
				...makeOptions(),
			}),
		).resolves.toBeUndefined();

		// File must be intact
		await expect(Bun.file(planPath).text()).resolves.toBe("# content");
	});

	it("EXDEV cross-device fallback: copyFile+unlink used when rename throws EXDEV", async () => {
		const srcPath = path.join(artifactsLocalDir, "PLAN.md");
		const dstPath = path.join(tmpDir, ".omp", "plans", "MY_PLAN.md");
		await fs.mkdir(path.dirname(dstPath), { recursive: true });
		await Bun.write(srcPath, "# Cross-device plan");

		// Simulate EXDEV on the first rename call, then let the real copyFile/unlink run.
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
