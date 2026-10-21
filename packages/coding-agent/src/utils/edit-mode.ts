import { classifyModel } from "@oh-my-pi/pi-catalog/identity";
import { $flag } from "@oh-my-pi/pi-utils";

import type { EditMode } from "@oh-my-pi/pi-tui/tools/edit";
import type { Settings } from "../config/settings";
import { cfgEditMode, editModelVariants } from "../edit/settings";

export type { EditMode };

export const DEFAULT_EDIT_MODE: EditMode = "hashline";

const EDIT_MODE_IDS = {
	apply_patch: "apply_patch",
	hashline: "hashline",
	mimo: "mimo",
	patch: "patch",
	replace: "replace",
	sloppy: "sloppy",
} as const satisfies Record<string, EditMode>;

export const EDIT_MODES = Object.keys(EDIT_MODE_IDS) as EditMode[];

export function normalizeEditMode(mode?: string | null): EditMode | undefined {
	if (!mode) return undefined;
	return EDIT_MODE_IDS[mode as keyof typeof EDIT_MODE_IDS];
}

export interface EditModeSettingsLike {
	get(key: "edit.mode"): unknown;
	getEditVariantForModel?(model: string | undefined): EditMode | null;
}

/** First `edit.modelVariants` entry whose pattern occurs in `model` (case-insensitive). */
export function editVariantForModel(settings: Settings, model: string | undefined): EditMode | undefined {
	if (!model) return undefined;
	const modelLower = model.toLowerCase();
	return editModelVariants.get(settings).find(variant => modelLower.includes(variant.patternLower))?.mode;
}

export interface EditModeSessionLike {
	settings: Settings;
	getActiveModelString?: () => string | undefined;
}

export function resolveEditMode(session: EditModeSessionLike): EditMode {
	const activeModel = session.getActiveModelString?.();
	const modelVariant = editVariantForModel(session.settings, activeModel);
	if (modelVariant) return modelVariant;

	const mode = cfgEditMode.get(session.settings);
	// `PI_EDIT_VARIANT` pins the mode exactly; only settings-derived hashline adapts to the model.
	if (cfgEditMode.provenance(session.settings) === "env") return mode;
	if (mode === "hashline" && !$flag("PI_STRICT_EDIT_MODE") && activeModel) {
		const identity = classifyModel("", activeModel, { lenient: true });
		// MiMo models get the fork's MiMo-Code replacement mode (exact-match
		// replacer chain ported from MiMo-Code); other weak-fuzzy models degrade
		// to plain replace.
		if (identity.class === "mimo") return "mimo";
		if (
			identity.class === "kimi" ||
			identity.class === "minimax" ||
			identity.class === "deepseek" ||
			identity.class === "stepfun" ||
			identity.family === "codex-spark" ||
			(identity.class === "glm" && identity.family === "flash" && identity.revision === "5.3.0")
		) {
			return "replace";
		}
	}
	return mode;
}
