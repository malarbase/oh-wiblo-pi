import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetSettingsForTest, Settings, settings } from "../src/config/settings";

describe("settings provenance & layering", () => {
	beforeEach(async () => {
		resetSettingsForTest();
		await Settings.init();
	});

	afterEach(() => {
		resetSettingsForTest();
	});

	it("identifies default setting provenance when unmodified", () => {
		expect(settings.getLayer("autoResume")).toBe("default");
	});

	it("identifies global setting provenance when set with global scope", () => {
		settings.set("autoResume", false, { scope: "global" });
		expect(settings.getLayer("autoResume")).toBe("global");
		expect(settings.get("autoResume")).toBe(false);
	});

	it("identifies project setting provenance when set with project scope", () => {
		settings.set("autoResume", false, { scope: "project" });
		expect(settings.getLayer("autoResume")).toBe("project");
		expect(settings.get("autoResume")).toBe(false);
	});

	it("prioritizes override layer over global and project layers", async () => {
		resetSettingsForTest();
		await Settings.init({ overrides: { autoResume: true } });

		settings.set("autoResume", false, { scope: "project" });
		expect(settings.getLayer("autoResume")).toBe("override");
		expect(settings.get("autoResume")).toBe(true);
	});

	it("clears project layer correctly and falls back to global or default", () => {
		settings.set("autoResume", false, { scope: "global" });
		settings.set("autoResume", true, { scope: "project" });
		expect(settings.getLayer("autoResume")).toBe("project");

		settings.clearProject("autoResume");
		expect(settings.getLayer("autoResume")).toBe("global");
		expect(settings.get("autoResume")).toBe(false);

		settings.clearGlobal("autoResume");
		expect(settings.getLayer("autoResume")).toBe("default");
	});
});
