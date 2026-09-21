// Stub: params module deleted upstream — not used by fork
export interface HashlineParams {
	filePath: string;
	content: string;
}

export const hashlineEditParamsSchema = {} as never;

export function parseHashlineParams(_input: string): HashlineParams {
	return { filePath: "", content: "" };
}
