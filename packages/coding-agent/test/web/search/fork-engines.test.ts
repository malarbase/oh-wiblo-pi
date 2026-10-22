import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AuthStorage } from "@oh-my-pi/pi-ai";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { roleCandidatePool } from "@oh-my-pi/pi-coding-agent/config/model-roles";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { OWP_SEARCH_ENGINE_IDS } from "@oh-my-pi/pi-coding-agent/web/search/types";
import { createInMemoryAuthStorage } from "../../helpers/agent-session-setup";

/**
 * The fork's web engines are reachable only through the catalog: the web role
 * chain resolves catalog models, so an engine without a `web/<id>` row is
 * loadable but can never be selected. The rows live in the fork's catalog
 * rules, which a sync may overwrite - these assertions are the alarm.
 */
describe("fork web engines", () => {
	let authStorage: AuthStorage;
	let settings: Settings;

	beforeEach(async () => {
		settings = await Settings.init({ inMemory: true });
		authStorage = createInMemoryAuthStorage();
	});

	afterEach(() => {
		resetSettingsForTest();
		authStorage.close();
	});

	it("keeps every fork engine selectable through the web role chain", () => {
		const registry = new ModelRegistry(authStorage, undefined, { settings });
		const selectable = new Set(
			roleCandidatePool("web", settings, registry).map(model => `${model.provider}/${model.id}`),
		);

		for (const id of OWP_SEARCH_ENGINE_IDS) {
			expect(
				selectable.has(`web/${id}`),
				`web/${id} is not in the web role chain - the catalog row for the fork's engine was dropped`,
			).toBe(true);
		}
	});
});
