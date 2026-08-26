import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";

import { HookInputComponent } from "@oh-my-pi/pi-coding-agent/modes/components/hook-input";
import { getThemeByName, setThemeInstance } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { TUI } from "@oh-my-pi/pi-tui";

beforeAll(async () => {
	const theme = await getThemeByName("dark");
	if (!theme) {
		throw new Error("Failed to load dark theme for tests");
	}
	setThemeInstance(theme);
});
describe("HookInputComponent timeout", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("resets timeout on user activity and still expires when idle", () => {
		vi.useFakeTimers();

		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const onTimeout = vi.fn();
		const tui = { requestRender: vi.fn() } as unknown as TUI;

		const component = new HookInputComponent("Prompt", undefined, onSubmit, onCancel, {
			timeout: 1_000,
			tui,
			onTimeout,
		});

		vi.advanceTimersByTime(900);
		component.handleInput("a");

		vi.advanceTimersByTime(900);
		component.handleInput("\x7f");

		vi.advanceTimersByTime(900);
		expect(onTimeout).not.toHaveBeenCalled();
		expect(onCancel).not.toHaveBeenCalled();

		vi.advanceTimersByTime(200);
		expect(onTimeout).toHaveBeenCalledTimes(1);
		expect(onCancel).toHaveBeenCalledTimes(1);

		component.dispose();
	});

	it("preserves submit behavior", () => {
		vi.useFakeTimers();

		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const onTimeout = vi.fn();
		const tui = { requestRender: vi.fn() } as unknown as TUI;

		const component = new HookInputComponent("Prompt", undefined, onSubmit, onCancel, {
			timeout: 1_000,
			tui,
			onTimeout,
		});

		component.handleInput("h");
		component.handleInput("i");
		component.handleInput("\n");

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith("hi");
		expect(onCancel).not.toHaveBeenCalled();
		expect(onTimeout).not.toHaveBeenCalled();

		component.dispose();
	});

	it("absorbs enhanced-paste payloads via pasteText and resets the timeout", () => {
		// Regression: enhanced-paste (kitty OSC 5522) focus routing only targets
		// components exposing a `pasteText` hook; without one the payload landed
		// in the hidden main prompt behind the dialog (#2127 contract).
		vi.useFakeTimers();

		const onSubmit = vi.fn();
		const onCancel = vi.fn();
		const onTimeout = vi.fn();
		const tui = { requestRender: vi.fn() } as unknown as TUI;

		const component = new HookInputComponent("Prompt", undefined, onSubmit, onCancel, {
			timeout: 1_000,
			tui,
			onTimeout,
		});

		vi.advanceTimersByTime(900);
		component.pasteText("sk-line1\nsk-line2");

		vi.advanceTimersByTime(900);
		expect(onTimeout).not.toHaveBeenCalled();
		expect(onCancel).not.toHaveBeenCalled();

		component.handleInput("\n");

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith("sk-line1sk-line2");

		component.dispose();
	});

	describe("HookInputComponent default value prefill", () => {
		it("prefills the input with the provided defaultValue", () => {
			const onSubmit = vi.fn();
			const onCancel = vi.fn();
			const component = new HookInputComponent("Plan title", "my_plan", onSubmit, onCancel);

			// Submitting without typing anything yields the prefilled value, not empty —
			// this is the contract the plan-mode "Save and exit" autopopulate relies on.
			component.handleInput("\n");
			expect(onSubmit).toHaveBeenCalledTimes(1);
			expect(onSubmit).toHaveBeenCalledWith("my_plan");
			expect(onCancel).not.toHaveBeenCalled();

			component.dispose();
		});

		it("leaves the input empty when defaultValue is undefined", () => {
			const onSubmit = vi.fn();
			const onCancel = vi.fn();
			const component = new HookInputComponent("Prompt", undefined, onSubmit, onCancel);

			component.handleInput("\n");
			expect(onSubmit).toHaveBeenCalledWith("");
			component.dispose();
		});

		it("lets the operator type over the prefilled value", () => {
			const onSubmit = vi.fn();
			const onCancel = vi.fn();
			const component = new HookInputComponent("Prompt", "suggested", onSubmit, onCancel);

			// Clear (delete to line start) then type a new value
			component.handleInput("\x15"); // Ctrl+U: delete to line start
			component.handleInput("o");
			component.handleInput("k");
			component.handleInput("\n");

			expect(onSubmit).toHaveBeenCalledWith("ok");
			component.dispose();
		});
	});
});
