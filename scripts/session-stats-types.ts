/**
 * Type definitions for pi session JSONL entries.
 * Only the fields we actually use are included.
 */

export interface CostBreakdown {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	total?: number;
}

export interface UsageInfo {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: CostBreakdown;
}

export interface AssistantMessage {
	role: "assistant";
	model?: string;
	usage?: UsageInfo;
}

export interface JsonlEntry {
	type: string;
	message?: AssistantMessage;
}