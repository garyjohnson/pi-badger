#!/usr/bin/env bun
/**
 * session-stats.ts — Extract model usage and cost for pi sessions
 *
 * Usage:
 *   bun scripts/session-stats.ts              # All sessions for this repo
 *   bun scripts/session-stats.ts --latest     # Only the latest session
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { JsonlEntry, AssistantMessage } from "./session-stats-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPRs(files: string[]): string[] {
	const prUrls = new Set<string>();
	const prRegex = /https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/pull\/\d+/g;

	for (const file of files) {
		const content = fs.readFileSync(file, "utf-8");
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			try {
				const obj: JsonlEntry = JSON.parse(line);
				if (obj.type === "message" && obj.message?.role === "assistant") {
					const msg: AssistantMessage = obj.message;
					const content = msg.content ?? [];
					if (Array.isArray(content)) {
						for (const c of content) {
							if (typeof c === "object" && c !== null && "text" in c) {
								const text = String(c.text);
								let match;
								while ((match = prRegex.exec(text)) !== null) {
									prUrls.add(match[0]);
								}
							}
						}
					}
				}
			} catch {
				// skip malformed lines
			}
		}
	}

	return [...prUrls].sort();
}

function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

interface ModelStats {
	cost: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

function parseSessionDir(): string {
	const repoDir = path.resolve(import.meta.dir, "..");
	// Pi encodes cwd by stripping leading / and replacing / with -
	const sessionName = repoDir.replace(/^\//, "").replace(/\//g, "-");
	const sessionDir = path.join(os.homedir(), ".pi", "agent", "sessions", `--${sessionName}--`);
	return sessionDir;
}

function getSessionFiles(sessionDir: string, latestOnly: boolean): string[] {
	const files = fs.readdirSync(sessionDir)
		.filter((f: string) => f.endsWith(".jsonl") && !f.endsWith(".bak"))
		.sort()
		.map((f: string) => path.join(sessionDir, f));

	if (latestOnly && files.length > 0) {
		return [files[files.length - 1]!];
	}
	return files;
}

function collectStats(files: string[]): Map<string, ModelStats> {
	const models = new Map<string, ModelStats>();

	for (const file of files) {
		const content = fs.readFileSync(file, "utf-8");
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			try {
				const obj: JsonlEntry = JSON.parse(line);
				if (obj.type === "message" && obj.message?.role === "assistant") {
					const msg: AssistantMessage = obj.message;
					const model = msg.model ?? "unknown";
					const usage = msg.usage ?? {};
					const cost = usage.cost ?? {};

					const stats: ModelStats = models.get(model) ?? { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
					stats.cost += cost.total ?? 0;
					stats.input += usage.input ?? 0;
					stats.output += usage.output ?? 0;
					stats.cacheRead += usage.cacheRead ?? 0;
					stats.cacheWrite += usage.cacheWrite ?? 0;
					models.set(model, stats);
				}
			} catch {
				// skip malformed lines
			}
		}
	}

	return models;
}

function printReport(models: Map<string, ModelStats>, prs: string[]): void {
	const sorted = [...models.entries()].sort((a, b) => b[1].cost - a[1].cost);

	let totalCost = 0;
	let totalInput = 0;
	let totalOutput = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let totalTokens = 0;

	for (const [, m] of sorted) {
		totalCost += m.cost;
		totalInput += m.input;
		totalOutput += m.output;
		totalCacheRead += m.cacheRead;
		totalCacheWrite += m.cacheWrite;
	}
	totalTokens = totalInput + totalOutput + totalCacheRead + totalCacheWrite;

	if (totalTokens === 0) {
		console.log("No assistant messages found in sessions.");
		return;
	}

	// PRs section (if any)
	if (prs.length > 0) {
		console.log("### PRs created this session\n");
		for (const pr of prs) {
			console.log(`- ${pr}`);
		}
		console.log();
	}

	// Main table
	console.log("| Model | Tokens | % Tokens | Cost | % Cost |");
	console.log("|-------|--------|----------|------|--------|");
	for (const [model, m] of sorted) {
		const tokens = m.input + m.output + m.cacheRead + m.cacheWrite;
		const pctTokens = (tokens / totalTokens * 100);
		const pctCost = totalCost > 0 ? (m.cost / totalCost * 100) : 0;
		console.log(`| ${model} | ${fmtTokens(tokens)} | ${pctTokens.toFixed(1)}% | $${m.cost.toFixed(2)} | ${pctCost.toFixed(1)}% |`);
	}
	console.log(`| **Total** | **${fmtTokens(totalTokens)}** | | **$${totalCost.toFixed(2)}** | |`);

	// Expandable token breakdown
	console.log();
	console.log("<details><summary>Token breakdown</summary>");
	console.log();
	console.log("| Model | Input | Output | Cache Read | Cache Write |");
	console.log("|-------|-------|--------|------------|-------------|");
	for (const [model, m] of sorted) {
		console.log(`| ${model} | ${fmtTokens(m.input)} | ${fmtTokens(m.output)} | ${fmtTokens(m.cacheRead)} | ${fmtTokens(m.cacheWrite)} |`);
	}
	console.log(`| **Total** | **${fmtTokens(totalInput)}** | **${fmtTokens(totalOutput)}** | **${fmtTokens(totalCacheRead)}** | **${fmtTokens(totalCacheWrite)}** |`);
	console.log();
	console.log("</details>");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const latestOnly = process.argv.includes("--latest");
const sessionDir = parseSessionDir();

if (!fs.existsSync(sessionDir)) {
	console.error(`No pi sessions found for this repo at: ${sessionDir}`);
	process.exit(1);
}

const files = getSessionFiles(sessionDir, latestOnly);
if (files.length === 0) {
	console.error("No session files found.");
	process.exit(1);
}

const models = collectStats(files);
const prs = extractPRs(files);
printReport(models, prs);