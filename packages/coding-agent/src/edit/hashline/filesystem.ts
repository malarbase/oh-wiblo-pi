// Stub: filesystem module deleted upstream — not used by fork
import { Filesystem } from "@oh-my-pi/hashline";

export { InMemoryFilesystem as HashlineFilesystem };

export class InMemoryFilesystem extends Filesystem {
	#files = new Map<string, string>();

	override async readText(path: string): Promise<string> {
		const content = this.#files.get(path);
		if (content === undefined) throw new Error(`Not found: ${path}`);
		return content;
	}

	override async readBinary(path: string): Promise<Uint8Array> {
		const text = await this.readText(path);
		return new TextEncoder().encode(text);
	}

	override async writeText(path: string, content: string): Promise<{ text: string }> {
		this.#files.set(path, content);
		return { text: content };
	}

	override async delete(path: string): Promise<void> {
		this.#files.delete(path);
	}

	override async move(from: string, to: string, content?: string): Promise<void> {
		const existing = this.#files.get(from);
		if (existing === undefined) throw new Error(`Not found: ${from}`);
		this.#files.set(to, content ?? existing);
		this.#files.delete(from);
	}

	override async exists(path: string): Promise<boolean> {
		return this.#files.has(path);
	}

	set(path: string, content: string): void {
		this.#files.set(path, content);
	}
}
