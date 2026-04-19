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
import { Text } from "@mariozechner/pi-tui";

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
	fileFilter?: string[];
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
	debug: boolean;
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
	debug: false,
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
// Debug Logger
// ---------------------------------------------------------------------------

class DebugLogger {
	private logPath: string;
	private enabled: boolean;
	private stream: fs.WriteStream | null = null;

	constructor(cwd: string, enabled: boolean) {
		this.enabled = enabled;
		this.logPath = path.join(cwd, ".pi", "badger-debug.log");
		if (this.enabled) {
			this.open();
		}
	}

	get isEnabled(): boolean {
		return this.enabled;
	}

	setEnabled(enabled: boolean, cwd: string): void {
		const changed = this.enabled !== enabled;
		this.enabled = enabled;
		if (changed) {
			if (this.enabled) {
				this.logPath = path.join(cwd, ".pi", "badger-debug.log");
				this.open();
				this.log("session", "Debug mode enabled");
			} else {
				this.log("session", "Debug mode disabled");
				this.close();
			}
		}
	}

	private open(): void {
		try {
			const dir = path.dirname(this.logPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			this.stream = fs.createWriteStream(this.logPath, { flags: "a" });
		} catch {
			this.stream = null;
		}
	}

	private close(): void {
		if (this.stream) {
			this.stream.end();
			this.stream = null;
		}
	}

	log(category: string, message: string, details?: Record<string, unknown>): void {
		if (!this.enabled) return;

		const timestamp = new Date().toISOString();
		const prefix = `[${timestamp}] [${category}]`;
		let line = details
			? `${prefix} ${message} ${JSON.stringify(details, null, 2)}`
			: `${prefix} ${message}`;

		// Also write to stderr so it shows in pi's process output
		process.stderr.write(`🐛 ${line}\n`);

		if (this.stream) {
			this.stream.write(line + "\n");
		}
	}

	getLogPath(): string {
		return this.logPath;
	}

	getLogContent(): string {
		try {
			return fs.readFileSync(this.logPath, "utf-8");
		} catch {
			return "";
		}
	}

	clearLog(): void {
		try {
			fs.writeFileSync(this.logPath, "");
		} catch {
			// ignore
		}
	}
}

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
			debug: parsed.debug ?? DEFAULT_CONFIG.debug,
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
): { filePath: string; changeType: "added" | "modified" | "deleted"; oldHash?: string; newHash?: string }[] {
	const changes: { filePath: string; changeType: "added" | "modified" | "deleted"; oldHash?: string; newHash?: string }[] = [];

	// New or modified files
	for (const [filePath, info] of newMap) {
		const oldInfo = oldMap.get(filePath);
		if (!oldInfo) {
			changes.push({ filePath, changeType: "added", newHash: info.hash });
		} else if (oldInfo.hash !== info.hash) {
			changes.push({ filePath, changeType: "modified", oldHash: oldInfo.hash, newHash: info.hash });
		}
	}

	// Deleted files
	for (const filePath of oldMap.keys()) {
		if (!newMap.has(filePath)) {
			const oldInfo = oldMap.get(filePath)!;
			changes.push({ filePath, changeType: "deleted", oldHash: oldInfo.hash });
		}
	}

	return changes;
}

/** Get just file paths from diff results */
function diffFilePaths(changes: ReturnType<typeof diffHashMaps>): string[] {
	return changes.map(c => c.filePath);
}

/** Run a script and return exit code and output. Pass signal to support cancellation. */
async function runScript(
	pi: ExtensionAPI,
	cwd: string,
	scriptPath: string,
	args: string[] = [],
	signal?: AbortSignal,
): Promise<{ exitCode: number; stdout: string; stderr: string; aborted: boolean }> {
	const fullPath = path.resolve(cwd, scriptPath);
	try {
		const result = await pi.exec(fullPath, args, { cwd, signal });
		return {
			exitCode: result.code ?? 1,
			stdout: result.stdout,
			stderr: result.stderr,
			aborted: false,
		};
	} catch (err) {
		// Check if the error is due to abort
		if (signal?.aborted) {
			return {
				exitCode: -1,
				stdout: "",
				stderr: "Aborted",
				aborted: true,
			};
		}
		return {
			exitCode: 1,
			stdout: "",
			stderr: err instanceof Error ? err.message : String(err),
			aborted: false,
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
	let debugLog: DebugLogger;

	// Debug logger is initialized after config load; create a disabled placeholder
	debugLog = new DebugLogger("", false);

	// -----------------------------------------------------------------------
	// Session start — load config, build initial hash map
	// -----------------------------------------------------------------------
	pi.on("session_start", async (_event, ctx) => {
		config = loadConfig(ctx.cwd);

		// Check env var override
		const envDebug = process.env.BADGER_DEBUG === "1" || process.env.BADGER_DEBUG === "true";

		if (!config) {
			// Initialize logger even without config (for env var debugging)
			debugLog = new DebugLogger(ctx.cwd, envDebug);
			debugLog.log("config", "No badger.json found", { cwd: ctx.cwd, envDebug });

			if (DEFAULT_CONFIG.notifyWithoutConfig) {
				ctx.ui.notify(
					"Badger is installed but not configured. Run /badger-setup to get started.",
					"info",
				);
			}
			return;
		}

		// Env var overrides config
		const debugEnabled = envDebug || config.debug;
		debugLog = new DebugLogger(ctx.cwd, debugEnabled);

		debugLog.log("session_start", "Session starting", {
			cwd: ctx.cwd,
			debug: debugEnabled,
			envDebug,
			configDebug: config.debug,
			watchPatterns: config.watchPatterns,
			excludePatterns: config.excludePatterns,
			checksFastCount: config.checksFast.length,
			checksCount: config.checks.length,
			hasRelease: !!config.release,
		});

		// Build initial hash map of watched files
		currentHashMap = buildHashMap(
			ctx.cwd,
			config.watchPatterns,
			config.excludePatterns,
		);
		// Last-pass starts as current state — no changes to check yet
		lastPassHashMap = new Map(currentHashMap);

		const fileCount = currentHashMap.size;
		debugLog.log("session_start", "Initial hash map built", {
			fileCount,
			files: fileCount <= 50 ? Array.from(currentHashMap.keys()) : `${fileCount} files (too many to list)`,
		});

		ctx.ui.notify(`Badger active — watching ${fileCount} file(s)${debugEnabled ? " (debug)" : ""}`, "info");

		if (debugEnabled) {
			ctx.ui.setStatus("badger-debug", "🐛 Debug ON");
		}
	});

	// -----------------------------------------------------------------------
	// Before agent start — inject system prompt
	// -----------------------------------------------------------------------
	pi.on("before_agent_start", async (event) => {
		if (!config) return {};

		debugLog.log("before_agent_start", "Injecting Badger system prompt");

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
		if (!config || config.checksFast.length === 0) {
			debugLog.log("turn_end", "Skipping fast checks", {
				hasConfig: !!config,
				checksFastCount: config?.checksFast.length ?? 0,
			});
			return;
		}

		debugLog.log("turn_end", "Checking for changed files");

		// Rebuild hash map efficiently (only re-hash changed files)
		const newHashMap = rebuildHashMap(
			ctx.cwd,
			config.watchPatterns,
			config.excludePatterns,
			currentHashMap,
		);

		const changes = diffHashMaps(currentHashMap, newHashMap);
		const changedFiles = diffFilePaths(changes);
		currentHashMap = newHashMap;

		debugLog.log("turn_end", "File change detection", {
			changedCount: changedFiles.length,
			changes: changes.map(c => ({
				file: c.filePath,
				type: c.changeType,
				...(c.oldHash ? { oldHash: c.oldHash } : {}),
				...(c.newHash ? { newHash: c.newHash } : {}),
			})),
		});

		if (changedFiles.length === 0) {
			debugLog.log("turn_end", "No files changed, skipping fast checks");
			return;
		}

		// Abort any in-flight fast checks — stale results are no longer relevant
		if (fastCheckAbortController) {
			debugLog.log("turn_end", "Aborting previous fast check run", {
				reason: "new changes detected, previous results would be stale",
			});
			fastCheckAbortController.abort();
		}

		fastCheckAbortController = new AbortController();
		const { signal } = fastCheckAbortController;

		// Capture values for the async closure (ctx may be stale after handler returns)
		const currentConfig = config;
		const filesToCheck = [...changedFiles];
		const cwd = ctx.cwd;

		debugLog.log("turn_end", "Starting fast checks", {
			filesToCheck,
			entryCount: currentConfig.checksFast.length,
		});

		// Run fast checks asynchronously (don't block the next turn)
		(async () => {
			for (const entry of currentConfig.checksFast) {
				if (signal.aborted) {
					debugLog.log("fast_check", "Cancelled before execution — new changes superseded this run", { path: entry.path });
					return;
				}

				// Filter changed files through fileFilter if configured
				let entryFiles = filesToCheck;
				if (entry.fileFilter && entry.fileFilter.length > 0) {
					const filterMatch = picomatch(entry.fileFilter, { dot: true });
					entryFiles = filesToCheck.filter((f) => filterMatch(f.replace(/\\/g, "/")));
				}

				debugLog.log("fast_check", "Evaluating entry", {
					path: entry.path,
					fileFilter: entry.fileFilter,
					matchingFiles: entryFiles,
					skipped: entryFiles.length === 0,
				});

				// Skip this entry if no matching files changed
				if (entryFiles.length === 0) continue;

				const startTime = Date.now();
				const result = await runScript(pi, cwd, entry.path, entryFiles, signal);
				const elapsed = Date.now() - startTime;

				if (result.aborted) {
					debugLog.log("fast_check", "Cancelled during execution — new changes superseded this run", {
						path: entry.path,
						elapsedMs: elapsed,
					});
					return;
				}

				debugLog.log("fast_check", "Script completed", {
					path: entry.path,
					exitCode: result.exitCode,
					elapsedMs: elapsed,
					stdoutLength: result.stdout.length,
					stderrLength: result.stderr.length,
					stdout: result.stdout.length <= 500 ? result.stdout : result.stdout.slice(0, 500) + "...[truncated]",
					stderr: result.stderr.length <= 500 ? result.stderr : result.stderr.slice(0, 500) + "...[truncated]",
				});

				if (signal.aborted) {
					debugLog.log("fast_check", "Cancelled — new changes detected after script finished", {
						path: entry.path,
						exitCode: result.exitCode,
					});
					return;
				}

				if (result.exitCode !== 0) {
					const output = result.stderr || result.stdout;
					const failurePrompt =
						entry.failurePrompt || DEFAULT_FAST_FAILURE_PROMPT;
					const message = `Badger fast check failed (${
						entry.path
					}) on files: ${entryFiles.join(", ")}\n\n\`\`\`\n${output}\n\`\`\`\n\n${failurePrompt}`;

					debugLog.log("fast_check", "Failed — short-circuiting remaining entries", {
						path: entry.path,
						exitCode: result.exitCode,
						files: entryFiles,
					});

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
			debugLog.log("fast_check", "All fast checks passed");
		})();
	});

	// -----------------------------------------------------------------------
	// Agent end — run checks, then release on success
	// -----------------------------------------------------------------------
	pi.on("agent_end", async (_event, ctx) => {
		if (!config) return;
		if (isRunningChecks || isRunningRelease) {
			debugLog.log("agent_end", "Skipping — checks or release already in progress", {
				isRunningChecks,
				isRunningRelease,
			});
			return;
		}

		if (config.checks.length === 0 && !config.release) {
			debugLog.log("agent_end", "No checks or release configured");
			return;
		}

		debugLog.log("agent_end", "Checking for changes since last pass");

		// Rebuild hash map and check if files changed since last pass
		const newHashMap = rebuildHashMap(
			ctx.cwd,
			config.watchPatterns,
			config.excludePatterns,
			currentHashMap,
		);
		currentHashMap = newHashMap;

		const changes = diffHashMaps(lastPassHashMap, newHashMap);
		const changed = diffFilePaths(changes);

		debugLog.log("agent_end", "Changes since last pass", {
			changedCount: changed.length,
			changes: changes.map(c => ({
				file: c.filePath,
				type: c.changeType,
			})),
		});

		if (changed.length === 0) {
			debugLog.log("agent_end", "No changes since last pass — skipping checks");
			return;
		}

		// Files changed since last pass — run checks
		isRunningChecks = true;
		debugLog.log("agent_end", "Starting full checks", {
			changedFiles: changed,
			entryCount: config.checks.length,
		});

		try {
			// Run checks entries, collecting all failures from script entries
			const failures: string[] = [];

			for (const entry of config.checks) {
				if (entry.type === "script" && entry.path) {
					const startTime = Date.now();
					const result = await runScript(pi, ctx.cwd, entry.path);
					const elapsed = Date.now() - startTime;

					debugLog.log("agent_check", "Script completed", {
						path: entry.path,
						exitCode: result.exitCode,
						elapsedMs: elapsed,
						stdoutLength: result.stdout.length,
						stderrLength: result.stderr.length,
						stdout: result.stdout.length <= 500 ? result.stdout : result.stdout.slice(0, 500) + "...[truncated]",
						stderr: result.stderr.length <= 500 ? result.stderr : result.stderr.slice(0, 500) + "...[truncated]",
					});

					if (result.exitCode !== 0) {
						const output = result.stderr || result.stdout;
						const failurePrompt =
							entry.failurePrompt || DEFAULT_CHECKS_FAILURE_PROMPT;
						failures.push(
							`**${entry.path}** failed (exit code ${result.exitCode}):\n\n\`\`\`\n${output}\n\`\`\`\n\n${failurePrompt}`,
						);
					}
				} else if (entry.type === "prompt" && entry.content) {
					debugLog.log("agent_check", "Sending prompt entry", {
						contentLength: entry.content.length,
						contentPreview: entry.content.slice(0, 200),
					});
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
				debugLog.log("agent_check", "Checks failed", {
					failureCount: failures.length,
				});
				pi.sendUserMessage(message);
				// Don't update lastPassHashMap — will re-check after pi fixes
				return;
			}

			// All checks passed — update last-pass hash map
			lastPassHashMap = new Map(newHashMap);
			debugLog.log("agent_check", "All checks passed — updated lastPassHashMap", {
				fileCount: lastPassHashMap.size,
			});

			// Notify user of passing checks
			ctx.ui.notify("✓ All checks passed", "info");

			// Run release
			if (config.release) {
				isRunningRelease = true;
				debugLog.log("agent_release", "Starting release");

				try {
					if (config.release.type === "script" && config.release.path) {
						const startTime = Date.now();
						const result = await runScript(
							pi,
							ctx.cwd,
							config.release.path,
						);
						const elapsed = Date.now() - startTime;

						debugLog.log("agent_release", "Script completed", {
							path: config.release.path,
							exitCode: result.exitCode,
							elapsedMs: elapsed,
							stdoutLength: result.stdout.length,
							stderrLength: result.stderr.length,
							stdout: result.stdout.length <= 500 ? result.stdout : result.stdout.slice(0, 500) + "...[truncated]",
							stderr: result.stderr.length <= 500 ? result.stderr : result.stderr.slice(0, 500) + "...[truncated]",
						});

						if (result.exitCode !== 0) {
							const output = result.stderr || result.stdout;
							const failurePrompt =
								config.release.failurePrompt ||
								DEFAULT_RELEASE_FAILURE_PROMPT;
							ctx.ui.notify("✗ Release failed", "error");
							debugLog.log("agent_release", "Release failed", {
								exitCode: result.exitCode,
							});
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
							debugLog.log("agent_release", "Release succeeded");
						}
					} else if (
						config.release.type === "prompt" &&
						config.release.content
					) {
						debugLog.log("agent_release", "Sending release prompt");
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

checksFast entries target specific concerns (lint, typecheck, per-file tests) and use \`fileFilter\` to route only relevant changed files to each script. Entries without \`fileFilter\` receive all changed files. If no files match a \`fileFilter\`, that entry is skipped entirely.`;
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
			debugLog.log("manual_check", "Manually triggered full checks");

			isRunningChecks = true;
			try {
				const failures: string[] = [];

				for (const entry of config.checks) {
					if (entry.type === "script" && entry.path) {
						const startTime = Date.now();
						const result = await runScript(pi, ctx.cwd, entry.path);
						const elapsed = Date.now() - startTime;

						debugLog.log("manual_check", "Script completed", {
							path: entry.path,
							exitCode: result.exitCode,
							elapsedMs: elapsed,
						});

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
				debugLog.log("manual_check", "All checks passed");

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
			debugLog.log("manual_release", "Manually triggered release");

			isRunningRelease = true;
			try {
				if (config.release.type === "script" && config.release.path) {
					const startTime = Date.now();
					const result = await runScript(
						pi,
						ctx.cwd,
						config.release.path,
					);
					const elapsed = Date.now() - startTime;

					debugLog.log("manual_release", "Script completed", {
						path: config.release.path,
						exitCode: result.exitCode,
						elapsedMs: elapsed,
					});

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
	// /badger-debug command — toggle debug mode, view log, clear log
	// -----------------------------------------------------------------------
	pi.registerCommand("badger-debug", {
		description: "Toggle Badger debug mode. Use 'on'/'off' to toggle, 'log' to view, 'clear' to clear log",
		handler: async (args, ctx) => {
			const subcommand = (args || "").trim().toLowerCase();

			if (!config) {
				ctx.ui.notify(
					"Badger is not configured. Run /badger-setup first.",
					"warning",
				);
				return;
			}

			if (subcommand === "off") {
				debugLog.setEnabled(false, ctx.cwd);
				config.debug = false;
				ctx.ui.setStatus("badger-debug", undefined);
				ctx.ui.notify("🐛 Badger debug mode OFF", "info");
				return;
			}

			if (subcommand === "clear") {
				debugLog.clearLog();
				ctx.ui.notify("🐛 Debug log cleared", "info");
				return;
			}

			if (subcommand === "log") {
				const content = debugLog.getLogContent();
				if (!content) {
					ctx.ui.notify("Debug log is empty", "info");
				} else {
					const lastLines = content.split("\n").slice(-100).join("\n");
					pi.sendUserMessage(`**Badger debug log** (last 100 lines):\n\n\`\`\`\n${lastLines}\n\`\`\``);
				}
				return;
			}

			if (subcommand === "status") {
				const lines = [
					`🐛 Badger Debug Status`,
					`  Enabled: ${debugLog.isEnabled}`,
					`  Log path: ${debugLog.getLogPath()}`,
					`  Watch patterns: ${config.watchPatterns.join(", ")}`,
					`  Exclude patterns: ${config.excludePatterns.join(", ") || "(none)"}`,
					`  Files tracked: ${currentHashMap.size}`,
					`  Last-pass files: ${lastPassHashMap.size}`,
					`  Fast checks: ${config.checksFast.length} entries`,
					`  Full checks: ${config.checks.length} entries`,
					`  Has release: ${!!config.release}`,
					`  Running checks: ${isRunningChecks}`,
					`  Running release: ${isRunningRelease}`,
				];

				// Compute pending changes since last pass
				if (currentHashMap.size > 0) {
					const changes = diffHashMaps(lastPassHashMap, currentHashMap);
					if (changes.length > 0) {
						lines.push(`  Pending changes: ${changes.length}`);
						for (const c of changes.slice(0, 20)) {
							lines.push(`    ${c.changeType}: ${c.filePath}`);
						}
						if (changes.length > 20) {
							lines.push(`    ... and ${changes.length - 20} more`);
						}
					} else {
						lines.push(`  Pending changes: 0 (all clear)`);
					}
				}

				pi.sendUserMessage(lines.join("\n"));
				return;
			}

			// Default: toggle on
			if (!debugLog.isEnabled) {
				debugLog.setEnabled(true, ctx.cwd);
				config.debug = true;
				ctx.ui.setStatus("badger-debug", "🐛 Debug ON");
				debugLog.log("debug", "Debug mode enabled via /badger-debug command");
				ctx.ui.notify("🐛 Badger debug mode ON — logging to .pi/badger-debug.log", "info");
			} else {
				// Toggle off
				debugLog.setEnabled(false, ctx.cwd);
				config.debug = false;
				ctx.ui.setStatus("badger-debug", undefined);
				ctx.ui.notify("🐛 Badger debug mode OFF", "info");
			}
		},
	});

	// -----------------------------------------------------------------------
	// Register message renderer for debug-friendly display of badger messages
	// -----------------------------------------------------------------------
	pi.registerMessageRenderer("badger-fast-failure", (message, options, theme) => {
		const { expanded } = options;
		let text = theme.fg("error", "☠ Badger fast check failed");
		if (expanded && message.content) {
			text += "\n" + message.content;
		}
		return new Text(text, 0, 0);
	});

	pi.registerMessageRenderer("badger-release-failure", (message, options, theme) => {
		const { expanded } = options;
		let text = theme.fg("error", "☠ Badger release failed");
		if (expanded && message.content) {
			text += "\n" + message.content;
		}
		return new Text(text, 0, 0);
	});

	pi.registerMessageRenderer("badger-check-prompt", (message, options, theme) => {
		let text = theme.fg("accent", "📋 Badger check prompt");
		if (options.expanded && message.content) {
			text += "\n" + message.content;
		}
		return new Text(text, 0, 0);
	});

	pi.registerMessageRenderer("badger-release-prompt", (message, options, theme) => {
		let text = theme.fg("accent", "📋 Badger release prompt");
		if (options.expanded && message.content) {
			text += "\n" + message.content;
		}
		return new Text(text, 0, 0);
	});

	// -----------------------------------------------------------------------
	// Session persistence — state is rebuilt from file hashes on session start
	// No explicit save needed since hashing is deterministic
	// -----------------------------------------------------------------------
}