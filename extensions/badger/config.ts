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
	showTail: false,
	checksFast: [
		{
			type: "script",
			path: "scripts/lint",
			fileFilter: ["*.ts", "*.tsx", "*.js", "*.jsx"],
			failurePrompt: "Fix the lint issues identified above and continue working.",
		},
		{
			type: "script",
			path: "scripts/typecheck",
			failurePrompt: "Fix the type errors identified above and continue working.",
		},
		{
			type: "script",
			path: "scripts/test_changed",
			fileFilter: ["*.test.ts", "*.spec.ts", "*.test.js", "*.spec.js"],
			failurePrompt: "Fix the test failures identified above and continue working.",
		},
	],
	checks: [
		{
			type: "script",
			path: "scripts/check",
			failurePrompt: "Fix the test failures and continue working.",
		},
	],
	release: {
		type: "script",
		path: "scripts/release",
		failurePrompt: "The release failed. Review the errors above.",
	},
};

export const DEFAULT_FAST_FAILURE_PROMPT =
	"Fix the issues identified above and continue working.";
export const DEFAULT_CHECKS_FAILURE_PROMPT =
	"Fix the test failures and continue working.";
export const DEFAULT_RELEASE_FAILURE_PROMPT =
	"The release failed. Review the errors above.";

export const SYSTEM_PROMPT = `You are working with the Badger quality gate extension. Follow this workflow:

1. Make your changes as requested.
2. When you see a Badger fast check failure, fix the identified issues and continue.
3. When you see a Badger check failure, fix the identified issues and continue.
4. Do not run test or release scripts yourself — Badger runs them automatically.
5. Keep working until Badger is satisfied or the user intervenes.`;

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Load and merge badger.json with defaults.
 * Returns null if no config file exists or it's unreadable/invalid.
 */
export function loadConfig(cwd: string): BadgerConfig | null {
	const configPath = path.join(cwd, ".pi", "badger.json");
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
		checksFast: parsed.checksFast ?? DEFAULT_CONFIG.checksFast,
		checks: parsed.checks ?? DEFAULT_CONFIG.checks,
		release: parsed.release === null ? null : (parsed.release ?? DEFAULT_CONFIG.release),
	};
}

/**
 * Save a BadgerConfig to .pi/badger.json in the given cwd.
 */
export function saveConfig(cwd: string, config: BadgerConfig): void {
	const configPath = path.join(cwd, ".pi", "badger.json");
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