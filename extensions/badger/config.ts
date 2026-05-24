/**
 * Badger — Configuration loading and defaults
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { BadgerConfig, CheckEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: BadgerConfig = {
	watchPatterns: ["src/**/*", "test/**/*", "lib/**/*", "pkg/**/*"],
	excludePatterns: [
		// Build / output directories
		"**/dist",
		"**/build",
		"**/.next",
		"**/.nuxt",
		"**/.turbo",
		// Package manager / dependency directories
		"**/node_modules",
		// Test output directories
		"**/playwright-report",
		"**/test-results",
		// Language-specific caches
		"**/__pycache__",
		"**/.venv",
		"**/venv",
		"**/.tox",
		// Caches and coverage
		"**/.cache",
		"**/coverage",
		// Internal pi directories
		"**/.pi",
		// Version control
		"**/.git",
	],

	debug: false,
	tailLines: 0,
	showTail: true,
	fastFail: true,
	checksFast: [],
	checks: [],
	release: null,
};

export const DEFAULT_FAST_FAILURE_PROMPT =
	"Fix the issues identified above and continue working.";
export const DEFAULT_CHECKS_FAILURE_PROMPT =
	"Fix the test failures and continue working.";
export const DEFAULT_RELEASE_FAILURE_PROMPT =
	"The release failed. Review the errors above.";

/**
 * Build a Badger system prompt tailored to what the config has enabled.
 */
export function buildSystemPrompt(config: BadgerConfig): string {
	const steps: string[] = [];

	steps.push("You are working with the Badger quality gate extension. Follow this workflow:");

	if (config.checksFast && config.checksFast.length > 0) {
		steps.push("1. Make your changes as requested.");
		steps.push("2. When you see a Badger fast check failure, fix the identified issues and continue.");
		steps.push("3. When you see a Badger check failure, fix the identified issues and continue.");
		steps.push("4. Do not run test or release scripts yourself — Badger runs them automatically.");
		steps.push("5. Keep working until Badger is satisfied or the user intervenes.");
	} else if (config.checks && config.checks.length > 0) {
		steps.push("1. Make your changes as requested.");
		steps.push("2. When you see a Badger check failure, fix the identified issues and continue.");
		steps.push("3. Do not run test or release scripts yourself — Badger runs them automatically.");
		steps.push("4. Keep working until Badger is satisfied or the user intervenes.");
	} else {
		steps.push("1. Make your changes as requested.");
		steps.push("2. Keep working until Badger is satisfied or the user intervenes.");
	}

	return steps.join("\n");
}

export const SYSTEM_PROMPT = buildSystemPrompt(DEFAULT_CONFIG);

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Walk up from startDir looking for .pi/badger.json.
 * Returns the directory containing it, or null if not found.
 */
export function findConfigDir(startDir: string): string | null {
	let current = path.resolve(startDir);
	while (true) {
		const configPath = path.join(current, ".pi", "badger.json");
		if (fs.existsSync(configPath)) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}
	return null;
}

/**
 * Load and merge badger.json with defaults.
 * Returns null if no config file exists or it's unreadable/invalid.
 */
export function loadConfig(cwd: string): BadgerConfig | null {
	const configDir = findConfigDir(cwd);
	if (!configDir) {
		return null;
	}
	const configPath = path.join(configDir, ".pi", "badger.json");
	let raw: string;
	try {
		raw = fs.readFileSync(configPath, "utf-8");
	} catch {
		return null;
	}

	let parsed: Partial<BadgerConfig>;
	try {
		parsed = JSON.parse(raw) as Partial<BadgerConfig>;
	} catch {
		return null;
	}

	return {
		watchPatterns: parsed.watchPatterns ?? DEFAULT_CONFIG.watchPatterns,
		excludePatterns: parsed.excludePatterns ?? DEFAULT_CONFIG.excludePatterns,

		debug: parsed.debug ?? DEFAULT_CONFIG.debug,
		tailLines: parsed.tailLines ?? DEFAULT_CONFIG.tailLines,
		showTail: parsed.showTail ?? DEFAULT_CONFIG.showTail,
		fastFail: parsed.fastFail ?? DEFAULT_CONFIG.fastFail,
		checksFast: parsed.checksFast ?? DEFAULT_CONFIG.checksFast,
		checks: parsed.checks ?? DEFAULT_CONFIG.checks,
		release: parsed.release === undefined ? null : parsed.release,
	};
}

/**
 * Save a BadgerConfig to .pi/badger.json in the given cwd.
 */
export function saveConfig(cwd: string, config: BadgerConfig): void {
	const configDir = findConfigDir(cwd) ?? cwd;
	const configPath = path.join(configDir, ".pi", "badger.json");
	const dir = path.dirname(configPath);

	try {
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
	} catch {
		// ignore
	}

	try {
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
	} catch {
		// ignore write failures
	}
}
