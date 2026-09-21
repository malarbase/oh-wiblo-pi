/**
 * Tools permitted in Ask mode. Any tool not in this set is blocked
 * at execution time with a descriptive refusal message.
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
	"read",
	"grep",
	"find",
	"lsp",
	"inspect_image",
	"calc",
	"web_search",
	"fetch",
	"search_tool_bm25",
	"ast_grep",
	"ask",
	"todo_write",
	"await",
	"cancel_job",
]);

export function isReadOnlyTool(name: string): boolean {
	return READ_ONLY_TOOLS.has(name);
}
