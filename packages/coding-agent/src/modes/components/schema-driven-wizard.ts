/**
 * Schema-Driven Wizard Component
 *
 * Generic multi-step TUI wizard that takes WizardField descriptors and produces
 * a Record<string, unknown> result. Supports text, number, boolean, enum,
 * array, and record inputs.
 */
import { Container, Input, matchesKey, type SelectItem, SelectList, Spacer, Text } from "@oh-my-pi/pi-tui";
import type { WizardField } from "../../config/schema-introspector";
import { getSelectListTheme, theme } from "../theme/theme";
import { matchesAppInterrupt } from "../utils/keybinding-matchers";
import { DynamicBorder } from "./dynamic-border";

export interface SchemaWizardResult {
	values: Record<string, unknown>;
	cancelled: boolean;
}

/**
 * A multi-step wizard driven by WizardField descriptors.
 */
export class SchemaDrivenWizard extends Container {
	#fields: WizardField[];
	#currentIndex = 0;
	#values: Record<string, unknown> = {};
	#inputField: Input | null = null;
	#selectList: SelectList | null = null;
	#contentContainer: Container;
	#onComplete: (values: Record<string, unknown>) => void;
	#onCancel: () => void;
	#onRender: () => void;
	#validationError: string | null = null;

	constructor(
		title: string,
		fields: WizardField[],
		onComplete: (values: Record<string, unknown>) => void,
		onCancel: () => void,
		onRender: () => void,
	) {
		super();
		this.#fields = fields;
		this.#onComplete = onComplete;
		this.#onCancel = onCancel;
		this.#onRender = onRender;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold(theme.fg("accent", title)), 0, 0));
		this.addChild(new Spacer(1));

		this.#contentContainer = new Container();
		this.addChild(this.#contentContainer);

		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.#renderCurrentField();
	}

	handleInput(data: string): void {
		if (matchesAppInterrupt(data)) {
			this.#onCancel();
			return;
		}

		if (this.#inputField) {
			if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "\n") {
				this.#saveAndAdvance();
				return;
			}
			this.#inputField.handleInput(data);
			return;
		}

		if (this.#selectList) {
			this.#selectList.handleInput(data);
			return;
		}
	}

	#saveAndAdvance(): void {
		const field = this.#fields[this.#currentIndex];

		if (this.#inputField) {
			const raw = this.#inputField.getValue().trim();
			if (field.required && !raw) {
				this.#validationError = "This field is required";
				this.#renderCurrentField();
				return;
			}
			this.#validationError = null;
			this.#values[field.key] = this.#parseValue(field, raw);
		}

		this.#advance();
	}

	#advance(): void {
		this.#currentIndex++;

		// Skip fields whose conditions are not met
		while (this.#currentIndex < this.#fields.length) {
			const nextField = this.#fields[this.#currentIndex];
			if (nextField.condition && !nextField.condition(this.#values)) {
				this.#currentIndex++;
				continue;
			}
			break;
		}

		if (this.#currentIndex >= this.#fields.length) {
			this.#onComplete(this.#values);
			return;
		}

		this.#renderCurrentField();
	}

	#renderCurrentField(): void {
		this.#contentContainer.clear();
		this.#inputField = null;
		this.#selectList = null;

		const field = this.#fields[this.#currentIndex];
		if (!field) {
			this.#contentContainer.addChild(
				new Text(theme.fg("error", "Schema error: no fields to display. Check provider configuration."), 0, 0),
			);
			this.#onRender();
			return;
		}

		// Label
		this.#contentContainer.addChild(new Text(theme.bold(theme.fg("text", field.label)), 0, 0));
		this.#contentContainer.addChild(new Spacer(1));

		// Description
		if (field.description) {
			this.#contentContainer.addChild(new Text(theme.fg("muted", field.description), 0, 0));
			this.#contentContainer.addChild(new Spacer(1));
		}

		switch (field.type) {
			case "text":
			case "number": {
				this.#inputField = new Input();
				if (field.defaultValue !== undefined) {
					this.#inputField.setValue(String(field.defaultValue));
				}
				this.#contentContainer.addChild(this.#inputField);
				break;
			}
			case "boolean": {
				const items: SelectItem[] = [
					{ value: "true", label: "Yes" },
					{ value: "false", label: "No" },
				];
				if (!field.required) {
					items.unshift({ value: "__skip__", label: "Skip" });
				}
				this.#selectList = new SelectList(items, items.length, getSelectListTheme());
				const defaultValue = field.defaultValue ?? false;
				const idx = items.findIndex(i => i.value === String(defaultValue));
				if (idx !== -1) this.#selectList.setSelectedIndex(idx);
				this.#selectList.onSelect = item => {
					if (item.value !== "__skip__") {
						this.#values[field.key] = item.value === "true";
					}
					this.#advance();
				};
				this.#selectList.onCancel = () => this.#onCancel();
				this.#contentContainer.addChild(this.#selectList);
				break;
			}
			case "enum": {
				const items: SelectItem[] =
					field.options?.map((o: { value: string; label: string; description?: string }) => ({
						value: o.value,
						label: o.label,
						description: o.description,
					})) ?? [];
				if (!field.required) {
					items.unshift({ value: "__skip__", label: "Skip" });
				}
				this.#selectList = new SelectList(items, Math.min(items.length, 10), getSelectListTheme());
				if (field.defaultValue !== undefined) {
					const idx = items.findIndex(i => i.value === String(field.defaultValue));
					if (idx !== -1) this.#selectList.setSelectedIndex(idx);
				}
				this.#selectList.onSelect = item => {
					if (item.value !== "__skip__") {
						this.#values[field.key] = item.value;
					}
					this.#advance();
				};
				this.#selectList.onCancel = () => this.#onCancel();
				this.#contentContainer.addChild(this.#selectList);
				break;
			}
			case "object": {
				this.#contentContainer.addChild(
					new Text(theme.fg("warning", "Nested object configuration not yet supported in wizard"), 0, 0),
				);
				break;
			}
			case "array":
			case "record": {
				this.#inputField = new Input();
				if (field.defaultValue !== undefined) {
					this.#inputField.setValue(JSON.stringify(field.defaultValue));
				}
				this.#contentContainer.addChild(this.#inputField);
				break;
			}
		}

		this.#contentContainer.addChild(new Spacer(1));

		// Validation error
		if (this.#validationError) {
			this.#contentContainer.addChild(new Text(theme.fg("error", `✗ ${this.#validationError}`), 0, 0));
			this.#contentContainer.addChild(new Spacer(1));
		}

		// Progress
		const progress = `Step ${this.#currentIndex + 1} of ${this.#fields.length}`;
		this.#contentContainer.addChild(new Text(theme.fg("dim", progress), 0, 0));

		// Hint
		if (!field.required) {
			this.#contentContainer.addChild(
				new Text(theme.fg("dim", "[Enter to continue, Esc to cancel, optional field]"), 0, 0),
			);
		} else {
			this.#contentContainer.addChild(new Text(theme.fg("dim", "[Enter to continue, Esc to cancel]"), 0, 0));
		}

		this.#onRender();
	}

	#parseValue(field: WizardField, raw: string): unknown {
		switch (field.type) {
			case "number":
				return Number(raw) || 0;
			case "boolean":
				return raw === "true";
			case "array":
			case "record":
				try {
					return JSON.parse(raw);
				} catch {
					return raw;
				}
			default:
				return raw;
		}
	}
}
