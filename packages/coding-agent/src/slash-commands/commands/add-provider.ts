import { addProviderToModelsConfig } from "../../config/models-config-writer";
import { probeEndpoint } from "../../config/provider-probe";
import { ProviderOnboardingWizard } from "../../modes/components/provider-onboarding-wizard";
import type { InteractiveModeContext } from "../../modes/types";
import { commandConsumed } from "../helpers/parse";
import type { SlashCommandRuntime, SlashCommandSpec } from "../types";

async function handleAddProviderNonInteractive(args: string, ctx: InteractiveModeContext): Promise<void> {
	const tokens = args.split(/\s+/).filter(Boolean);
	if (tokens.length < 3) {
		ctx.showStatus("Usage: /add-provider <name> <baseUrl> <apiKey>");
		return;
	}
	const [name, baseUrl, apiKey] = tokens;
	const probe = await probeEndpoint(baseUrl, apiKey);
	const config: Record<string, unknown> = {
		baseUrl: probe.baseUrl,
		apiKey: probe.apiKey,
		api: probe.api,
		auth: probe.auth,
		authHeader: probe.authHeader,
		discovery: probe.discovery,
	};
	await addProviderToModelsConfig(name, config);
	await ctx.session.modelRegistry.refresh("online");
	ctx.showStatus(`Provider "${name}" added. Discovered ${probe.models?.length ?? 0} models.`);
}

async function handleAddProviderTui(
	command: Parameters<NonNullable<SlashCommandSpec["handleTui"]>>[0],
	runtime: Parameters<NonNullable<SlashCommandSpec["handleTui"]>>[1],
): Promise<undefined> {
	const ctx = runtime.ctx;

	// Non-interactive path: positional args → probe + write
	if (command.args.trim()) {
		await handleAddProviderNonInteractive(command.args, ctx);
		ctx.editor.setText("");
		return undefined;
	}

	const { promise, resolve } = Promise.withResolvers<
		{ saved: true; providerName: string; providerConfig: Record<string, unknown> } | { saved: false }
	>();

	const wizard = new ProviderOnboardingWizard(
		result => resolve({ saved: true, ...result }),
		() => resolve({ saved: false }),
		() => ctx.ui.requestRender(),
	);

	const overlay = ctx.ui.showOverlay(wizard, {
		anchor: "center",
		width: "80%",
		maxHeight: "80%",
	});
	ctx.ui.setFocus(wizard);

	let result: Awaited<typeof promise>;
	try {
		result = await promise;
	} finally {
		overlay.hide();
	}

	if (result.saved) {
		try {
			await addProviderToModelsConfig(result.providerName, result.providerConfig);
			await ctx.session.modelRegistry.refresh("online");
			ctx.showStatus(`Provider "${result.providerName}" added.`);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			ctx.showStatus(`Failed to add provider: ${message}`);
		}
	} else {
		ctx.showStatus("Cancelled.");
	}

	ctx.editor.setText("");
	return undefined;
}

const handleAddProviderAcp = async (
	command: Parameters<NonNullable<SlashCommandSpec["handle"]>>[0],
	runtime: SlashCommandRuntime,
) => {
	if (command.args.trim()) {
		const tokens = command.args.split(/\s+/).filter(Boolean);
		if (tokens.length < 3) {
			await runtime.output("Usage: /add-provider <name> <baseUrl> <apiKey>");
			return commandConsumed();
		}
		const [name, baseUrl, apiKey] = tokens;
		const probe = await probeEndpoint(baseUrl, apiKey);
		const config: Record<string, unknown> = {
			baseUrl: probe.baseUrl,
			apiKey: probe.apiKey,
			api: probe.api,
			auth: probe.auth,
			authHeader: probe.authHeader,
			discovery: probe.discovery,
		};
		await addProviderToModelsConfig(name, config);
		await runtime.session.modelRegistry.refresh("online");
		await runtime.output(`Provider "${name}" added. Discovered ${probe.models?.length ?? 0} models.`);
		return commandConsumed();
	}
	await runtime.output(
		"Provider onboarding requires interactive TUI mode. Usage: /add-provider <name> <baseUrl> <apiKey>",
	);
	return commandConsumed();
};

export const handleAddProviderCommand: Pick<SlashCommandSpec, "handle" | "handleTui"> = {
	handle: handleAddProviderAcp,
	handleTui: handleAddProviderTui,
};
