/**
 * Badger — Quality Gate Extension for Pi
 *
 * Automatically runs checks when files change and enforces a test-pass-release workflow:
 *
 * 1. checksFast: per-turn fast checks (lint, typecheck) on changed files, async with abort
 * 2. checks: full test suite at agent_end, loop until pass
 * 3. release: run after checks pass, on failure notify user only
 *
 * Configured via .pi/badger.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import * as crypto from "node:crypto";
import picomatch from "picomatch";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CheckEntry {
	type: "script" | "prompt";
	path?: string;
	content?: string;
	failurePrompt?: string;
}

interface FastCheckEntry {
	type: "script";
	path: string;
	failurePrompt?: string;
}

interface ReleaseEntry {
	type: "script" | "prompt";
	path?: string;
	content?: string;
	failurePrompt?: string;
}

interface BadgerConfig {
	watchPatterns: string[];
	excludePatterns: string[];
	notifyWithoutConfig: boolean;
	checksFast: FastCheckEntry[];
	checks: CheckEntry[];
	release?: ReleaseEntry | null;
}

interface FileHash {
	hash: string;
	mtime: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: BadgerConfig = {
	watchPatterns: ["src/**/*", "test/**/*", "lib/**/*", "pkg/**/*"],
	excludePatterns: [],
	notifyWithoutConfig: true,
	checksFast: [
		{
			type: "script",
			path: "scripts/lint",
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

const DEFAULT_FAST_FAILURE_PROMPT =
	"Fix the issues identified above and continue working.";
const DEFAULT_CHECKS_FAILURE_PROMPT =
	"Fix the test failures and continue working.";
const DEFAULT_RELEASE_FAILURE_PROMPT =
	"The release failed. Review the errors above.";

const SYSTEM_PROMPT = `You are working with the Badger quality gate extension. Follow this workflow:

1. Make your changes as requested.
2. When you see a Badger fast check failure, fix the identified issues and continue.
3. When you see a Badger check failure, fix the identified issues and continue.
4. Do not run test or release scripts yourself — Badger runs them automatically.
5. Keep working until Badger is satisfied or the user intervenes.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadConfig(cwd: string): BadgerConfig | null {
	const configPath = path.join(cwd, ".pi", "badger.json");
	try {
		const raw = fs.readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(raw) as Partial<BadgerConfig>;
		// Merge with defaults
		return {
			watchPatterns: parsed.watchPatterns ?? DEFAULT_CONFIG.watchPatterns,
			excludePatterns: parsed.excludePatterns ?? DEFAULT_CONFIG.excludePatterns,
			notifyWithoutConfig: parsed.notifyWithoutConfig ?? DEFAULT_CONFIG.notifyWithoutConfig,
			checksFast: parsed.checksFast ?? DEFAULT_CONFIG.checksFast,
			checks: parsed.checks ?? DEFAULT_CONFIG.checks,
			release: parsed.release === null ? null : (parsed.release ?? DEFAULT_CONFIG.release),
		};
	} catch {
		return null;
	}
}

/** Check if a file path matches include patterns and not exclude patterns */
function matchesPatterns(
	filePath: string,
	includePatterns: string[],
	excludePatterns: string[],
): boolean {
	const isMatch = picomatch(includePatterns, { dot: true });
	const isExcluded = excludePatterns.length > 0
		? picomatch(excludePatterns, { dot: true })
		: () => false;

	// Normalize to forward slashes
	const normalized = filePath.replace(/\\/g, "/");
	return isMatch(normalized) && !isExcluded(normalized);
}

// Directories to skip when walking the file tree
const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".pi",
	".next",
	".nuxt",
	"coverage",
	".cache",
	".turbo",
	"__pycache__",
	".tox",
	"target",
	"venv",
	".venv",
]);

/** Recursively discover files matching watch patterns */
function discoverWatchedFiles(
	cwd: string,
	includePatterns: string[],
	excludePatterns: string[],
): string[] {
	const results: string[] = [];

	function walkDir(dir: string): void {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				walkDir(path.join(dir, entry.name));
			} else if (entry.isFile()) {
				const filePath = path.relative(cwd, path.join(dir, entry.name)).replace(/\\/g, "/");
				if (matchesPatterns(filePath, includePatterns, excludePatterns)) {
					results.push(filePath);
				}
			}
		}
	}

	walkDir(cwd);
	return results.sort();
}

/** Compute a hash of a file's contents */
function hashFile(cwd: string, filePath: string): string {
	const fullPath = path.join(cwd, filePath);
	try {
		const content = fs.readFileSync(fullPath);
		return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
	} catch {
		return "";
	}
}

/** Get mtime of a file */
function getFileMtime(cwd: string, filePath: string): number {
	const fullPath = path.join(cwd, filePath);
	try {
		const stat = fs.statSync(fullPath);
		return stat.mtimeMs;
	} catch {
		return 0;
	}
}

/** Build a hash map of watched files */
function buildHashMap(
	cwd: string,
	includePatterns: string[],
	excludePatterns: string[],
): Map<string, FileHash> {
	const files = discoverWatchedFiles(cwd, includePatterns, excludePatterns);
	const map = new Map<string, FileHash>();
	for (const filePath of files) {
		map.set(filePath, {
			hash: hashFile(cwd, filePath),
			mtime: getFileMtime(cwd, filePath),
		});
	}
	return map;
}

/** Rebuild hash map efficiently: only re-hash files whose mtime changed, discover new/deleted files */
function rebuildHashMap(
	cwd: string,
	includePatterns: string[],
	excludePatterns: string[],
	oldMap: Map<string, FileHash>,
): Map<string, FileHash> {
	// Discover current files (to detect additions and deletions)
	const currentFiles = new Set(
		discoverWatchedFiles(cwd, includePatterns, excludePatterns),
	);

	const newMap = new Map<string, FileHash>();

	// Check existing entries: keep hash if mtime unchanged, re-hash if changed
	for (const filePath of currentFiles) {
		const oldEntry = oldMap.get(filePath);
		const currentMtime = getFileMtime(cwd, filePath);

		if (oldEntry && oldEntry.mtime === currentMtime) {
			// File unchanged since last check — reuse hash
			newMap.set(filePath, oldEntry);
		} else {
			// New file or modified — compute fresh hash
			newMap.set(filePath, {
				hash: hashFile(cwd, filePath),
				mtime: currentMtime,
			});
		}
	}

	return newMap;
}

/** Diff two hash maps, returning files where hashes differ or files were added/removed */
function diffHashMaps(
	oldMap: Map<string, FileHash>,
	newMap: Map<string, FileHash>,
): string[] {
	const changed: string[] = [];

	// New or modified files
	for (const [filePath, info] of newMap) {
		const oldInfo = oldMap.get(filePath);
		if (!oldInfo || oldInfo.hash !== info.hash) {
			changed.push(filePath);
		}
	}

	// Deleted files
	for (const filePath of oldMap.keys()) {
		if (!newMap.has(filePath)) {
			changed.push(filePath);
		}
	}

	return changed;
}

/** Run a script and return exit code and output */
async function runScript(
	pi: ExtensionAPI,
	cwd: string,
	scriptPath: string,
	args: string[] = [],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const fullPath = path.resolve(cwd, scriptPath);
	try {
		const result = await pi.exec(fullPath, args, { cwd });
		return {
			exitCode: result.code ?? 1,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	} catch (err) {
		return {
			exitCode: 1,
			stdout: "",
			stderr: err instanceof Error ? err.message : String(err),
		};
	}
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function badgerExtension(pi: ExtensionAPI) {
	let config: BadgerConfig | null = null;
	let currentHashMap = new Map<string, FileHash>();
	let lastPassHashMap = new Map<string, FileHash>();
	let fastCheckAbortController: AbortController | null = null;
	let isRunningChecks = false;
	let isRunningRelease = false;

	// -----------------------------------------------------------------------
	// Session start — load config, build initial hash map
	// -----------------------------------------------------------------------
	pi.on("session_start", async (_event, ctx) => {
		config = loadConfig(ctx.cwd);

		if (!config) {
			if (DEFAULT_CONFIG.notifyWithoutConfig) {
				ctx.ui.notify(
					"Badger is installed but not configured. Run /badger-setup to get started.",
					"info",
				);
			}
			return;
		}

		// Build initial hash map of watched files
		currentHashMap = buildHashMap(
			ctx.cwd,
			config.watchPatterns,
			config.excludePatterns,
		);
		// Last-pass starts as current state — no changes to check yet
		lastPassHashMap = new Map(currentHashMap);

		const fileCount = currentHashMap.size;
		ctx.ui.notify(`Badger active — watching ${fileCount} file(s)`, "info");
	});

	// -----------------------------------------------------------------------
	// Before agent start — inject system prompt
	// -----------------------------------------------------------------------
	pi.on("before_agent_start", async (event) => {
		if (!config) return {};

		return {
			systemPrompt:
				event.systemPrompt +
				"\n\n## Badger Quality Gate\n\n" +
				SYSTEM_PROMPT,
		};
	});

	// -----------------------------------------------------------------------
	// Turn end — run checksFast if files changed
	// -----------------------------------------------------------------------
	pi.on("turn_end", async (_event, ctx) => {
		if (!config || config.checksFast.length === 0) return;

		// Rebuild hash map efficiently (only re-hash changed files)
		const newHashMap = rebuildHashMap(
			ctx.cwd,
			config.watchPatterns,
			config.excludePatterns,
			currentHashMap,
		);
		const changedFiles = diffHashMaps(currentHashMap, newHashMap);

		// Update current hash map regardless of whether we run checks
		currentHashMap = newHashMap;

		if (changedFiles.length === 0) return;

		// Abort any in-flight fast checks — stale results are no longer relevant
		if (fastCheckAbortController) {
			fastCheckAbortController.abort();
		}

		fastCheckAbortController = new AbortController();
		const { signal } = fastCheckAbortController;

		// Capture values for the async closure (ctx may be stale after handler returns)
		const currentConfig = config;
		const filesToCheck = [...changedFiles];
		const cwd = ctx.cwd;

		// Run fast checks asynchronously (don't block the next turn)
		(async () => {
			for (const entry of currentConfig.checksFast) {
				if (signal.aborted) return;

				const result = await runScript(pi, cwd, entry.path, filesToCheck);

				if (signal.aborted) return;

				if (result.exitCode !== 0) {
					const output = result.stderr || result.stdout;
					const failurePrompt =
						entry.failurePrompt || DEFAULT_FAST_FAILURE_PROMPT;
					const message = `Badger fast check failed (${
						entry.path
					}) on files: ${filesToCheck.join(", ")}\n\n\`\`\`\n${output}\n\`\`\`\n\n${failurePrompt}`;

					pi.sendMessage(
						{
							customType: "badger-fast-failure",
							content: message,
							display: true,
						},
						{ deliverAs: "steer", triggerTurn: true },
					);
					return; // Short-circuit on first failure
				}
			}
			// All fast checks passed — silent
		})();
	});

	// -----------------------------------------------------------------------
	// Agent end — run checks, then release on success
	// -----------------------------------------------------------------------
	pi.on("agent_end", async (_event, ctx) => {
		if (!config) return;
		if (isRunningChecks || isRunningRelease) return;

		if (config.checks.length === 0 && !config.release) return;

		// Rebuild hash map and check if files changed since last pass
		const newHashMap = rebuildHashMap(
			ctx.cwd,
			config.watchPatterns,
			config.excludePatterns,
			currentHashMap,
		);
		currentHashMap = newHashMap;

		const changed = diffHashMaps(lastPassHashMap, newHashMap);

		if (changed.length === 0) return;

		// Files changed since last pass — run checks
		isRunningChecks = true;

		try {
			// Run checks entries, collecting all failures from script entries
			const failures: string[] = [];

			for (const entry of config.checks) {
				if (entry.type === "script" && entry.path) {
					const result = await runScript(pi, ctx.cwd, entry.path);

					if (result.exitCode !== 0) {
						const output = result.stderr || result.stdout;
						const failurePrompt =
							entry.failurePrompt || DEFAULT_CHECKS_FAILURE_PROMPT;
						failures.push(
							`**${entry.path}** failed (exit code ${result.exitCode}):\n\n\`\`\`\n${output}\n\`\`\`\n\n${failurePrompt}`,
						);
					}
				} else if (entry.type === "prompt" && entry.content) {
					// Prompt entries are fire-and-forget — no pass/fail gate
					pi.sendMessage(
						{
							customType: "badger-check-prompt",
							content: entry.content,
							display: true,
						},
						{ deliverAs: "followUp", triggerTurn: true },
					);
				}
			}

			if (failures.length > 0) {
				const message = `Badger checks failed:\n\n${failures.join("\n\n")}`;
				pi.sendUserMessage(message);
				// Don't update lastPassHashMap — will re-check after pi fixes
				return;
			}

			// All checks passed — update last-pass hash map
			lastPassHashMap = new Map(newHashMap);

			// Notify user of passing checks
			ctx.ui.notify("✓ All checks passed", "info");

			// Run release
			if (config.release) {
				isRunningRelease = true;
				try {
					if (config.release.type === "script" && config.release.path) {
						const result = await runScript(
							pi,
							ctx.cwd,
							config.release.path,
						);

						if (result.exitCode !== 0) {
							const output = result.stderr || result.stdout;
							const failurePrompt =
								config.release.failurePrompt ||
								DEFAULT_RELEASE_FAILURE_PROMPT;
							ctx.ui.notify("✗ Release failed", "error");
							// Release failure is for the user only — pi doesn't fix it
							pi.sendMessage(
								{
									customType: "badger-release-failure",
									content: `Badger release failed (${
										config.release.path
									}):\n\n\`\`\`\n${output}\n\`\`\`\n\n${failurePrompt}`,
									display: true,
								},
								{ triggerTurn: false },
							);
						} else {
							ctx.ui.notify("✓ Released successfully", "info");
						}
					} else if (
						config.release.type === "prompt" &&
						config.release.content
					) {
						pi.sendMessage(
							{
								customType: "badger-release-prompt",
								content: config.release.content,
								display: true,
							},
							{ deliverAs: "followUp", triggerTurn: true },
						);
					}
				} finally {
					isRunningRelease = false;
				}
			}
		} finally {
			isRunningChecks = false;
		}
	});

	// -----------------------------------------------------------------------
	// /badger-setup command — runs setup by sending skill instructions to agent
	// -----------------------------------------------------------------------
	pi.registerCommand("badger-setup", {
		description: "Configure Badger quality gate for this project",
		handler: async (_args, ctx) => {
			// Read the skill file and send it to the agent as a user message
			const skillPath = path.join(__dirname, "..", "skills", "badger-setup", "SKILL.md");
			let skillContent: string;
			try {
				skillContent = fs.readFileSync(skillPath, "utf-8");
			} catch {
				// Skill file not found — fall back to a minimal setup prompt
				skillContent = `Analyze this project and create Badger configuration:

1. Detect the language, test framework, linter, and build tools
2. Create \`.pi/badger.json\` with appropriate watchPatterns, excludePatterns, checksFast, checks, and release settings
3. Create executable check scripts in \`scripts/\` — one per fast check (lint, typecheck, test\_changed), plus check and release
4. Each checksFast script should operate only on changed files (passed as arguments)
5. Make the scripts executable with chmod +x

checksFast entries should target specific concerns (lint, typecheck, per-file tests) for clear failure messages. All checksFast scripts receive changed file paths as arguments.`;
			}

			// Strip YAML frontmatter from skill content
			const contentWithoutFrontmatter = skillContent.replace(/^---\n[\s\S]*?---\n/, "");

			const message = `I want to set up Badger quality gate for this project. Please follow these instructions:\n\n${contentWithoutFrontmatter.trim()}`;

			pi.sendUserMessage(message);
		},
	});

	// -----------------------------------------------------------------------
	// /badger command — manually trigger full checks
	// -----------------------------------------------------------------------
	pi.registerCommand("badger", {
		description: "Manually trigger Badger checks",
		handler: async (_args, ctx) => {
			if (!config) {
				ctx.ui.notify(
					"Badger is not configured. Run /badger-setup first.",
					"warning",
				);
				return;
			}

			ctx.ui.notify("Running Badger checks...", "info");

			isRunningChecks = true;
			try {
				const failures: string[] = [];

				for (const entry of config.checks) {
					if (entry.type === "script" && entry.path) {
						const result = await runScript(pi, ctx.cwd, entry.path);

						if (result.exitCode !== 0) {
							const output = result.stderr || result.stdout;
							const failurePrompt =
								entry.failurePrompt || DEFAULT_CHECKS_FAILURE_PROMPT;
							failures.push(
								`**${entry.path}** failed (exit code ${result.exitCode}):\n\n\`\`\`\n${output}\n\`\`\`\n\n${failurePrompt}`,
							);
						}
					}
				}

				if (failures.length > 0) {
					const message = `Badger checks failed:\n\n${failures.join("\n\n")}`;
					pi.sendUserMessage(message);
					return;
				}

				ctx.ui.notify("✓ All checks passed", "info");

				// Update last-pass hash map
				lastPassHashMap = buildHashMap(
					ctx.cwd,
					config.watchPatterns,
					config.excludePatterns,
				);
			} finally {
				isRunningChecks = false;
			}
		},
	});

	// -----------------------------------------------------------------------
	// /badger-release command — manually trigger release
	// -----------------------------------------------------------------------
	pi.registerCommand("badger-release", {
		description: "Manually trigger Badger release",
		handler: async (_args, ctx) => {
			if (!config) {
				ctx.ui.notify(
					"Badger is not configured. Run /badger-setup first.",
					"warning",
				);
				return;
			}

			if (!config.release) {
				ctx.ui.notify("No release step configured.", "warning");
				return;
			}

			ctx.ui.notify("Running Badger release...", "info");

			isRunningRelease = true;
			try {
				if (config.release.type === "script" && config.release.path) {
					const result = await runScript(
						pi,
						ctx.cwd,
						config.release.path,
					);

					if (result.exitCode !== 0) {
						const output = result.stderr || result.stdout;
						const failurePrompt =
							config.release.failurePrompt ||
							DEFAULT_RELEASE_FAILURE_PROMPT;
						ctx.ui.notify("✗ Release failed", "error");
						pi.sendMessage(
							{
								customType: "badger-release-failure",
								content: `Badger release failed (${
									config.release.path
								}):\n\n\`\`\`\n${output}\n\`\`\`\n\n${failurePrompt}`,
								display: true,
							},
							{ triggerTurn: false },
						);
					} else {
						ctx.ui.notify("✓ Released successfully", "info");
					}
				} else if (
					config.release.type === "prompt" &&
					config.release.content
				) {
					pi.sendMessage(
						{
							customType: "badger-release-prompt",
							content: config.release.content,
							display: true,
						},
						{ deliverAs: "followUp", triggerTurn: true },
					);
				}
			} finally {
				isRunningRelease = false;
			}
		},
	});

	// -----------------------------------------------------------------------
	// Session persistence — state is rebuilt from file hashes on session start
	// No explicit save needed since hashing is deterministic
	// -----------------------------------------------------------------------
}