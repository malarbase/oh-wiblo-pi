import type { AgentTool } from "@oh-my-pi/pi-agent-core";

export interface DiscoverableMCPTool {
	name: string;
	label: string;
	description: string;
	serverName: string;
	mcpToolName: string;
	schemaKeys: string[];
}

export type DiscoverableMCPSearchIndex = unknown;

export function buildDiscoverableMCPSearchIndex(_tools: DiscoverableMCPTool[]): DiscoverableMCPSearchIndex {
	return null;
}

export function collectDiscoverableMCPTools(_tools: Iterable<AgentTool>): DiscoverableMCPTool[] {
	return [];
}

export function formatDiscoverableMCPToolServerSummary(_tools: DiscoverableMCPTool[]): string {
	return "";
}

export function selectDiscoverableMCPToolNamesByServer(
	_tools: DiscoverableMCPTool[],
	_serverName: string | Set<string>,
): string[] {
	return [];
}

export function isMCPToolName(_name: string): boolean {
	return false;
}
