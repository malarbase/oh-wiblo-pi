import { describe, expect, it } from "bun:test";
import { ProviderConfigSchema } from "../../src/config/models-config-schema";
import { introspectSchema, type WizardField } from "../../src/config/schema-introspector";

const CURATED_COMPAT_FIELDS = new Set([
	"thinkingFormat",
	"supportsStore",
	"supportsDeveloperRole",
	"supportsReasoningEffort",
	"supportsToolChoice",
	"supportsStrictMode",
	"maxTokensField",
]);

const WIZARD_EXCLUDED_KEYS = new Set(["headers", "models", "modelOverrides", "transport"]);

const PROVIDER_REQUIRED = new Set(["api", "baseUrl"]);

const PROVIDER_LABELS: Record<string, string> = {
	api: "API Type",
	baseUrl: "Base URL",
	apiKey: "API Key",
	auth: "Authentication",
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
	api: "The API protocol this provider uses",
	baseUrl: "The provider's API endpoint URL",
};

const PROVIDER_CONDITIONS: Record<string, (values: Record<string, unknown>) => boolean> = {
	apiKey: v => v.auth !== "none",
};

function buildProviderFields(): WizardField[] {
	return introspectSchema(ProviderConfigSchema, {
		requiredKeys: PROVIDER_REQUIRED,
		fieldLabels: PROVIDER_LABELS,
		fieldDescriptions: PROVIDER_DESCRIPTIONS,
		conditions: PROVIDER_CONDITIONS,
		maxDepth: 2,
	}).filter(f => {
		if (WIZARD_EXCLUDED_KEYS.has(f.key)) return false;
		if (f.key.startsWith("compat.")) {
			return CURATED_COMPAT_FIELDS.has(f.key.slice("compat.".length));
		}
		return true;
	});
}

describe("schema introspection", () => {
	it("introspects ProviderConfigSchema into wizard fields", () => {
		const fields = buildProviderFields();
		expect(fields.length).toBeGreaterThan(0);
	});

	it("produces required fields for api and baseUrl", () => {
		const fields = buildProviderFields();
		const required = fields.filter(f => f.required);
		const requiredKeys = required.map(f => f.key);
		expect(requiredKeys).toContain("api");
		expect(requiredKeys).toContain("baseUrl");
	});

	it("includes auth and apiKey fields", () => {
		const fields = buildProviderFields();
		const keys = fields.map(f => f.key);
		expect(keys).toContain("auth");
		expect(keys).toContain("apiKey");
	});

	it("assigns correct types to core fields", () => {
		const fields = buildProviderFields();
		const byKey = Object.fromEntries(fields.map(f => [f.key, f.type]));
		expect(byKey.baseUrl).toBe("text");
		expect(byKey.apiKey).toBe("text");
		expect(byKey.api).toBe("enum");
		expect(byKey.auth).toBe("enum");
		expect(byKey.authHeader).toBe("boolean");
	});

	it("includes curated compat fields with correct types", () => {
		const fields = buildProviderFields();
		const byKey = Object.fromEntries(fields.map(f => [f.key, f.type]));
		expect(byKey["compat.supportsStore"]).toBe("boolean");
		expect(byKey["compat.thinkingFormat"]).toBe("enum");
		expect(byKey["compat.maxTokensField"]).toBe("enum");
	});

	it("excludes non-curated compat fields", () => {
		const fields = buildProviderFields();
		const keys = fields.map(f => f.key);
		// supportsMultipleSystemMessages is NOT in CURATED_COMPAT_FIELDS
		expect(keys).not.toContain("compat.supportsMultipleSystemMessages");
	});

	it("includes discovery sub-fields from nested object", () => {
		const fields = buildProviderFields();
		const keys = fields.map(f => f.key);
		expect(keys).toContain("discovery.type");
		expect(keys).toContain("discovery.timeoutMs");
	});

	it("excludes headers, models, modelOverrides, transport", () => {
		const fields = buildProviderFields();
		const keys = fields.map(f => f.key);
		expect(keys).not.toContain("headers");
		expect(keys).not.toContain("models");
		expect(keys).not.toContain("modelOverrides");
		expect(keys).not.toContain("transport");
	});

	it("returns empty for non-object schemas", () => {
		const result = introspectSchema("not a schema");
		expect(result).toEqual([]);
	});

	it("returns empty for null/undefined", () => {
		expect(introspectSchema(null)).toEqual([]);
		expect(introspectSchema(undefined)).toEqual([]);
	});
});
