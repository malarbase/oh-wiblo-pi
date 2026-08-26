/**
 * Schema introspector for arktype v2 schemas.
 *
 * Uses the stable `schema.json` public API to extract field metadata for
 * the provider onboarding wizard. This is resilient to arktype internal
 * representation changes (the old code relied on `_def` which broke in v2).
 */

export interface WizardField {
	key: string;
	type: "text" | "number" | "boolean" | "enum" | "array" | "record" | "object";
	label: string;
	description?: string;
	required?: boolean;
	options?: Array<{ value: string; label: string; description?: string }>;
	defaultValue?: unknown;
	fields?: WizardField[];
	condition?: (values: Record<string, unknown>) => boolean;
}

/** Read the stable `schema.json` representation from an arktype Type. */
function getSchemaJson(schema: unknown): Record<string, unknown> | null {
	if (schema == null) return null;
	const s = schema as Record<string, unknown>;
	const json = s.json;
	if (!json || typeof json !== "object" || Array.isArray(json)) return null;
	// arktype v2 wraps narrowed schemas in `{ in: { domain, ... } }`
	const j = json as Record<string, unknown>;
	if (j.in && typeof j.in === "object" && !Array.isArray(j.in)) {
		return j.in as Record<string, unknown>;
	}
	return j;
}

/** Determine the WizardField type from an arktype json value descriptor. */
function inferFieldType(value: unknown): WizardField["type"] | null {
	if (typeof value === "string") {
		if (value === "string") return "text";
		if (value === "number") return "number";
		return null;
	}
	if (Array.isArray(value)) {
		// Boolean enum: exactly two entries, true and false
		if (
			value.length === 2 &&
			value.every(
				(v: unknown) =>
					typeof v === "object" &&
					v !== null &&
					("unit" in v
						? (v as Record<string, unknown>).unit === true || (v as Record<string, unknown>).unit === false
						: false),
			)
		) {
			return "boolean";
		}
		return "enum";
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const v = value as Record<string, unknown>;
		if (v.domain === "object") return "object";
		if (v.proto === "Array") return "array";
		if (v.index) return "record";
	}
	return null;
}

/** Extract enum options from an arktype json value descriptor. */
function extractEnumOptions(
	key: string,
	value: unknown,
	labels: Record<string, string>,
): Array<{ value: string; label: string }> | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.map((v: unknown) => {
		const unit = (v as Record<string, unknown>).unit;
		const raw = String(unit);
		return { value: raw, label: labels[`${key}.${raw}`] ?? raw };
	});
}

function buildField(
	key: string,
	value: unknown,
	requiredKeys: Set<string>,
	labels: Record<string, string>,
	descriptions: Record<string, string>,
	conditions: Record<string, (values: Record<string, unknown>) => boolean>,
): WizardField | null {
	const fieldType = inferFieldType(value);
	if (!fieldType) return null;

	const isEnum = fieldType === "enum" || fieldType === "boolean";

	return {
		key,
		type: fieldType,
		label: labels[key] ?? key,
		description: descriptions[key],
		required: requiredKeys.has(key),
		options: isEnum ? extractEnumOptions(key, value, labels) : undefined,
		condition: conditions[key],
	};
}

interface JsonField {
	key: string;
	value: unknown;
}

function introspectFields(
	prefix: string,
	json: Record<string, unknown>,
	requiredKeys: Set<string>,
	labels: Record<string, string>,
	descriptions: Record<string, string>,
	conditions: Record<string, (values: Record<string, unknown>) => boolean>,
	maxDepth: number,
	depth: number,
): WizardField[] {
	if (json.domain !== "object") return [];

	const fields: WizardField[] = [];

	const required = (json.required as JsonField[] | undefined) ?? [];
	const optional = (json.optional as JsonField[] | undefined) ?? [];

	const entries: Array<JsonField & { isRequired: boolean }> = [
		...required.map(e => ({ ...e, isRequired: true })),
		...optional.map(e => ({ ...e, isRequired: false })),
	];

	for (const { key, value, isRequired } of entries) {
		const fullKey = prefix ? `${prefix}.${key}` : key;
		const fieldType = inferFieldType(value);

		if (fieldType === "object" && depth < maxDepth) {
			const nested = introspectFields(
				fullKey,
				value as Record<string, unknown>,
				requiredKeys,
				labels,
				descriptions,
				conditions,
				maxDepth,
				depth + 1,
			);
			fields.push(...nested);
			continue;
		}

		const field = buildField(fullKey, value, requiredKeys, labels, descriptions, conditions);
		if (field) {
			// Schema-required or wizard-forced required
			field.required = isRequired || requiredKeys.has(key);
			fields.push(field);
		}
	}

	return fields;
}

export function introspectSchema(
	schema: unknown,
	options?: {
		requiredKeys?: string[] | Set<string>;
		fieldLabels?: Record<string, string>;
		fieldDescriptions?: Record<string, string>;
		conditions?: Record<string, (values: Record<string, unknown>) => boolean>;
		maxDepth?: number;
	},
): WizardField[] {
	const json = getSchemaJson(schema);
	if (!json) return [];

	const requiredKeys = options?.requiredKeys
		? options.requiredKeys instanceof Set
			? options.requiredKeys
			: new Set(options.requiredKeys)
		: new Set<string>();

	return introspectFields(
		"",
		json,
		requiredKeys,
		options?.fieldLabels ?? {},
		options?.fieldDescriptions ?? {},
		options?.conditions ?? {},
		options?.maxDepth ?? 3,
		0,
	);
}
