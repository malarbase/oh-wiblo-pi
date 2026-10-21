import { type } from "@oh-my-pi/omptype";
import { logger } from "@oh-my-pi/pi-utils";
import { YAML } from "bun";
import { ModelsConfigFile } from "./models-config";
import type { ModelsConfig } from "./models-config-schema";
import { ProviderConfigSchema } from "./models-config-schema";

export async function addProviderToModelsConfig(providerName: string, config: Record<string, unknown>): Promise<void> {
	const parsed = ProviderConfigSchema(config);
	if (parsed instanceof type.errors) {
		throw new Error(`Invalid provider config: ${parsed.summary}`);
	}

	const existing = ModelsConfigFile.loadOrDefault();
	const providers: NonNullable<ModelsConfig["providers"]> = {
		...(existing.providers ?? {}),
		[providerName]: parsed,
	};

	const updated: ModelsConfig = { ...existing, providers };
	const path = ModelsConfigFile.path();
	try {
		await Bun.write(path, YAML.stringify(updated, null, 2));
		ModelsConfigFile.invalidate();
		logger.debug("Added provider to models config", { providerName, path });
	} catch (err) {
		logger.error("Failed to write models config", { providerName, path, error: String(err) });
		throw new Error(`Failed to save provider ${providerName}: ${err instanceof Error ? err.message : String(err)}`);
	}
}
