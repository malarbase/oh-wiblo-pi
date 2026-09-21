/**
 * Provider Onboarding Wizard
 *
 * Interactive multi-step wizard for adding a new model provider.
 * Composes SchemaDrivenWizard for config fields with provider-specific
 * orchestration (name validation, auth flow, model addition, confirm).
 */
import { Container, Input, matchesKey, Spacer, Text } from "@oh-my-pi/pi-tui";
import { ProviderConfigSchema } from "../../config/models-config-schema";
import { addProviderToModelsConfig } from "../../config/models-config-writer";
import { introspectSchema, type WizardField } from "../../config/schema-introspector";
import { theme } from "../theme/theme";
import { matchesAppInterrupt } from "../utils/keybinding-matchers";
import { DynamicBorder } from "./dynamic-border";
import { SchemaDrivenWizard } from "./schema-driven-wizard";

export interface ProviderOnboardingResult {
	providerName: string;
	providerConfig: Record<string, unknown>;
}

type OnboardingStep = "name" | "config" | "confirm";

/** Curated compat fields exposed in the wizard. */
const CURATED_COMPAT_FIELDS = new Set([
	"thinkingFormat",
	"supportsStore",
	"supportsDeveloperRole",
	"supportsReasoningEffort",
	"supportsToolChoice",
	"supportsStrictMode",
	"maxTokensField",
]);

/** Fields treated as required for provider onboarding. */
const PROVIDER_REQUIRED = new Set(["api", "baseUrl"]);

/** Human-readable labels for provider config fields. */
const PROVIDER_LABELS: Record<string, string> = {
	api: "API Type",
	baseUrl: "Base URL",
	apiKey: "API Key",
	auth: "Authentication",
	authHeader: "Send as Authorization header",
	disableStrictTools: "Disable strict tool mode",
	discovery: "Auto-discovery",
	"discovery.type": "Discovery type",
	"compat.thinkingFormat": "Thinking format",
	"compat.supportsStore": "Supports store",
	"compat.supportsDeveloperRole": "Supports developer role",
	"compat.supportsReasoningEffort": "Supports reasoning effort",
	"compat.supportsToolChoice": "Supports tool choice",
	"compat.supportsStrictMode": "Supports strict mode",
	"compat.maxTokensField": "Max tokens field",
};

/** Descriptions for provider config fields. */
const PROVIDER_DESCRIPTIONS: Record<string, string> = {
	api: "The API protocol this provider uses",
	baseUrl: "The provider's API endpoint URL",
	apiKey: "Environment variable name or literal API key",
	auth: "How the provider authenticates requests",
	authHeader: "Send the API key as Authorization: Bearer header",
	disableStrictTools: "Disable strict mode for tool definitions",
	"discovery.type": "Auto-discover available models from the provider",
	"compat.thinkingFormat": "How reasoning/thinking content is formatted",
	"compat.supportsStore": "Provider supports the store parameter",
	"compat.supportsDeveloperRole": "Provider supports developer system role",
	"compat.supportsReasoningEffort": "Provider supports reasoning effort control",
	"compat.supportsToolChoice": "Provider supports tool choice directives",
	"compat.supportsStrictMode": "Provider supports strict tool mode",
	"compat.maxTokensField": "Field name for max tokens (max_tokens vs max_completion_tokens)",
};

/** Visibility conditions for conditional fields. */
const PROVIDER_CONDITIONS: Record<string, (values: Record<string, unknown>) => boolean> = {
	apiKey: v => v.auth !== "none",
	authHeader: v => v.auth !== "none",
};

/** Fields too complex for the simple onboarding wizard (advanced users can edit models.yml). */
const WIZARD_EXCLUDED_KEYS = new Set(["headers", "models", "modelOverrides", "transport"]);

function buildProviderFields(): WizardField[] {
	return introspectSchema(ProviderConfigSchema, {
		requiredKeys: PROVIDER_REQUIRED,
		fieldLabels: PROVIDER_LABELS,
		fieldDescriptions: PROVIDER_DESCRIPTIONS,
		conditions: PROVIDER_CONDITIONS,
		maxDepth: 2,
	}).filter((f: WizardField) => {
		if (WIZARD_EXCLUDED_KEYS.has(f.key)) return false;
		if (f.key.startsWith("compat.")) {
			return CURATED_COMPAT_FIELDS.has(f.key.slice("compat.".length));
		}
		return true;
	});
}

/**
 * Provider onboarding wizard component.
 */
export class ProviderOnboardingWizard extends Container {
	#step: OnboardingStep = "name";
	#providerName = "";
	#configValues: Record<string, unknown> = {};
	#contentContainer: Container;
	#inputField: Input | null = null;
	#configWizard: SchemaDrivenWizard | null = null;
	#validationError: string | null = null;
	#onComplete: (result: ProviderOnboardingResult) => void;
	#onCancel: () => void;
	#onRender: () => void;

	constructor(onComplete: (result: ProviderOnboardingResult) => void, onCancel: () => void, onRender: () => void) {
		super();
		this.#onComplete = onComplete;
		this.#onCancel = onCancel;
		this.#onRender = onRender;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold(theme.fg("accent", "Add Provider")), 0, 0));
		this.addChild(new Spacer(1));

		this.#contentContainer = new Container();
		this.addChild(this.#contentContainer);

		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.#renderStep();
	}

	handleInput(data: string): void {
		if (matchesAppInterrupt(data)) {
			this.#onCancel();
			return;
		}

		if (this.#step === "name" && this.#inputField) {
			if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "\n") {
				this.#saveNameAndProceed();
				return;
			}
			this.#inputField.handleInput(data);
			return;
		}

		if (this.#step === "config" && this.#configWizard) {
			this.#configWizard.handleInput(data);
			return;
		}

		if (this.#step === "confirm") {
			if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "\n") {
				void this.#doSave();
				return;
			}
		}
	}

	#saveNameAndProceed(): void {
		if (!this.#inputField) return;
		const name = this.#inputField.getValue().trim();

		if (!name) {
			this.#validationError = "Provider name is required";
			this.#renderStep();
			return;
		}

		if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
			this.#validationError = "Name can only contain letters, numbers, dashes, and underscores";
			this.#renderStep();
			return;
		}

		this.#providerName = name;
		this.#validationError = null;
		this.#step = "config";
		this.#renderConfigStep();
	}

	#renderStep(): void {
		this.#contentContainer.clear();
		this.#inputField = null;

		switch (this.#step) {
			case "name":
				this.#renderNameStep();
				break;
			case "confirm":
				this.#renderConfirmStep();
				break;
		}
	}

	#renderNameStep(): void {
		this.#contentContainer.addChild(new Text(theme.fg("accent", "Step 1: Provider Name"), 0, 0));
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text("Enter a unique name for this provider:", 0, 0));
		this.#contentContainer.addChild(new Spacer(1));

		this.#inputField = new Input();
		this.#inputField.setValue(this.#providerName);
		this.#contentContainer.addChild(this.#inputField);
		this.#contentContainer.addChild(new Spacer(1));

		if (this.#validationError) {
			this.#contentContainer.addChild(new Text(theme.fg("error", `✗ ${this.#validationError}`), 0, 0));
			this.#contentContainer.addChild(new Spacer(1));
		}

		this.#contentContainer.addChild(new Text(theme.fg("muted", "[Enter to continue, Esc to cancel]"), 0, 0));
		this.#onRender();
	}

	#renderConfigStep(): void {
		// Replace this wizard with a SchemaDrivenWizard for provider config
		const fields = buildProviderFields();
		this.#configWizard = new SchemaDrivenWizard(
			`Provider: ${this.#providerName}`,
			fields,
			values => {
				this.#configValues = values;
				this.#step = "confirm";
				this.#renderConfirmStep();
			},
			() => this.#onCancel(),
			() => this.#onRender(),
		);

		// Replace children with config wizard
		this.clear();
		this.addChild(this.#configWizard);
		this.#onRender();
	}

	#renderConfirmStep(): void {
		// Rebuild the container structure since config wizard replaced children
		this.clear();
		this.#configWizard = null;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold(theme.fg("accent", "Add Provider")), 0, 0));
		this.addChild(new Spacer(1));

		this.#contentContainer = new Container();
		this.addChild(this.#contentContainer);

		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.#contentContainer.addChild(new Text(theme.fg("accent", "Confirm Provider Configuration"), 0, 0));
		this.#contentContainer.addChild(new Spacer(1));

		this.#contentContainer.addChild(new Text(theme.bold(`Name: ${this.#providerName}`), 0, 0));
		this.#contentContainer.addChild(new Spacer(1));

		for (const [key, value] of Object.entries(this.#configValues)) {
			if (value === undefined || value === "" || value === false) continue;
			const label = PROVIDER_LABELS[key] ?? key;
			this.#contentContainer.addChild(new Text(`  ${label}: ${JSON.stringify(value)}`, 0, 0));
		}

		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text(theme.fg("muted", "[Enter to save, Esc to cancel]"), 0, 0));
		this.#onRender();
	}

	async #doSave(): Promise<void> {
		// Build provider config from values, filtering out empty/undefined/false defaults
		const config: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(this.#configValues)) {
			if (value === undefined || value === "" || value === false) continue;
			// Handle nested keys (e.g. compat.thinkingFormat)
			if (key.includes(".")) {
				const [parent, child] = key.split(".") as [string, string];
				if (!config[parent]) config[parent] = {};
				(config[parent] as Record<string, unknown>)[child] = value;
			} else {
				config[key] = value;
			}
		}

		await addProviderToModelsConfig(this.#providerName, config);
		this.#onComplete({ providerName: this.#providerName, providerConfig: config });
	}
}
