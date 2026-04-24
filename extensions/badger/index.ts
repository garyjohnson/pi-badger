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

import picomatch from "picomatch";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { BadgerState } from "./types.js";
import { loadConfig, SYSTEM_PROMPT, DEFAULT_FAST_FAILURE_PROMPT, DEFAULT_CHECKS_FAILURE_PROMPT, DEFAULT_RELEASE_FAILURE_PROMPT, DEFAULT_CONFIG } from "./config.js";
import { DebugLogger } from "./debug-logger.js";
import { rebuildHashMap, diffHashMaps, diffFilePaths } from "./file-watcher.js";
import { runEntry, entryLabel } from "./runner.js";
import { registerCommands } from "./commands.js";
import { registerRenderers } from "./renderers.js";

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function badgerExtension(pi: ExtensionAPI) {
	const state: BadgerState = {
		config: null,
		currentHashMap: new Map(),
		lastRunHashMap: new Map(),
		fastCheckAbortController: null,
		isRunningChecks: false,
		isRunningRelease: false,
	};

	let debugLog: DebugLogger = new DebugLogger("", false);

	// Register commands and renderers
	registerCommands(pi, state, () => debugLog);
	registerRenderers(pi);

	// -----------------------------------------------------------------------
	// Session start — load config, build initial hash map
	// -----------------------------------------------------------------------
	pi.on("session_start", async (_event, ctx) => {
		state.config = loadConfig(ctx.cwd);

		// Check env var override
		const envDebug = process.env.BADGER_DEBUG === "1" || process.env.BADGER_DEBUG === "true";

		if (!state.config) {
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
		const debugEnabled = envDebug || state.config.debug;
		debugLog = new DebugLogger(ctx.cwd, debugEnabled);

		debugLog.log("session_start", "Session starting", {
			cwd: ctx.cwd,
			debug: debugEnabled,
			envDebug,
			configDebug: state.config.debug,
			watchPatterns: state.config.watchPatterns,
			excludePatterns: state.config.excludePatterns,
			checksFastCount: state.config.checksFast.length,
			checksCount: state.config.checks.length,
			hasRelease: !!state.config.release,
		});

		// Build initial hash map of watched files
		state.currentHashMap = rebuildHashMap(
			ctx.cwd,
			state.config.watchPatterns,
			state.config.excludePatterns,
			new Map(), // empty old map → full scan
		);
		// lastRunHashMap starts as current state — no changes to check yet
		state.lastRunHashMap = new Map(state.currentHashMap);

		const fileCount = state.currentHashMap.size;
		debugLog.log("session_start", "Initial hash map built", {
			fileCount,
			files: fileCount <= 50 ? Array.from(state.currentHashMap.keys()) : `${fileCount} files (too many to list)`,
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
		if (!state.config) return {};

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
		if (!state.config || state.config.checksFast.length === 0) {
			debugLog.log("turn_end", "Skipping fast checks", {
				hasConfig: !!state.config,
				checksFastCount: state.config?.checksFast.length ?? 0,
			});
			return;
		}

		debugLog.log("turn_end", "Checking for changed files");

		// Rebuild hash map efficiently (only re-hash changed files)
		const newHashMap = rebuildHashMap(
			ctx.cwd,
			state.config.watchPatterns,
			state.config.excludePatterns,
			state.currentHashMap,
		);

		const changes = diffHashMaps(state.currentHashMap, newHashMap);
		const changedFiles = diffFilePaths(changes);
		state.currentHashMap = newHashMap;

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
		if (state.fastCheckAbortController) {
			debugLog.log("turn_end", "Aborting previous fast check run", {
				reason: "new changes detected, previous results would be stale",
			});
			state.fastCheckAbortController.abort();
		}

		state.fastCheckAbortController = new AbortController();
		const { signal } = state.fastCheckAbortController;

		// Capture values for the async closure (state may change after handler returns)
		const currentConfig = state.config;
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

				const label = entryLabel(entry);

				debugLog.log("fast_check", "Evaluating entry", {
					type: entry.type,
					label,
					fileFilter: entry.fileFilter,
					matchingFiles: entryFiles,
					skipped: entryFiles.length === 0,
				});

				// Skip this entry if no matching files changed
				if (entryFiles.length === 0) continue;

				const result = await runEntry(entry, cwd, pi, { signal, changedFiles: entryFiles });

				if (result.aborted) {
					debugLog.log("fast_check", "Cancelled during execution — new changes superseded this run", {
						label,
						elapsedMs: result.elapsed,
					});
					return;
				}

				debugLog.log("fast_check", "Check completed", {
					type: entry.type,
					label,
					exitCode: result.exitCode,
					elapsedMs: result.elapsed,
					stdoutLength: result.stdout.length,
					stderrLength: result.stderr.length,
					stdout: result.stdout.length <= 500 ? result.stdout : result.stdout.slice(0, 500) + "...[truncated]",
					stderr: result.stderr.length <= 500 ? result.stderr : result.stderr.slice(0, 500) + "...[truncated]",
				});

				if (signal.aborted) {
					debugLog.log("fast_check", "Cancelled — new changes detected after check finished", {
						label,
						exitCode: result.exitCode,
					});
					return;
				}

				if (result.exitCode !== 0) {
					const output = result.stderr || result.stdout;
					const failurePrompt = entry.failurePrompt || DEFAULT_FAST_FAILURE_PROMPT;
					const message = `Badger fast check failed (${label}) on files: ${entryFiles.join(", ")}\n\n\`\`\`\n${output}\n\`\`\`\n\n${failurePrompt}`;

					debugLog.log("fast_check", "Failed — short-circuiting remaining entries", {
						label,
						type: entry.type,
						exitCode: result.exitCode,
						files: entryFiles,
						output: output.slice(0, 1000),
						message: message.slice(0, 500),
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
		if (!state.config) return;
		if (state.isRunningChecks || state.isRunningRelease) {
			debugLog.log("agent_end", "Skipping — checks or release already in progress", {
				isRunningChecks: state.isRunningChecks,
				isRunningRelease: state.isRunningRelease,
			});
			return;
		}

		if (state.config.checks.length === 0 && !state.config.release) {
			debugLog.log("agent_end", "No checks or release configured");
			return;
		}

		debugLog.log("agent_end", "Checking for changes since last pass");

		// Rebuild hash map and check if files changed since last pass
		const newHashMap = rebuildHashMap(
			ctx.cwd,
			state.config.watchPatterns,
			state.config.excludePatterns,
			state.currentHashMap,
		);
		state.currentHashMap = newHashMap;

		const changes = diffHashMaps(state.lastRunHashMap, newHashMap);
		const changed = diffFilePaths(changes);

		debugLog.log("agent_end", "Changes since last checks run", {
			changedCount: changed.length,
			changes: changes.map(c => ({
				file: c.filePath,
				type: c.changeType,
			})),
		});

		if (changed.length === 0) {
			debugLog.log("agent_end", "No changes since last checks run — skipping checks");
			return;
		}

		// Mark as checked now so next agent_end won't re-run unless the agent makes new changes
		state.lastRunHashMap = new Map(newHashMap);

		state.isRunningChecks = true;
		debugLog.log("agent_end", "Starting full checks", {
			changedFiles: changed,
			entryCount: state.config.checks.length,
		});

		try {
			const failures: string[] = [];

			debugLog.log("agent_check", "Processing check entries", {
				entries: state.config.checks.map(e => ({
					type: e.type,
					label: entryLabel(e),
				})),
			});

			for (const entry of state.config.checks) {
				const label = entryLabel(entry);

				// Prompt entries are fire-and-forget
				if (entry.type === "prompt" && entry.content) {
					debugLog.log("agent_check", "Sending prompt entry", {
						contentLength: entry.content.length,
						contentPreview: entry.content.slice(0, 200),
					});
					pi.sendMessage(
						{
							customType: "badger-check-prompt",
							content: entry.content,
							display: true,
						},
						{ deliverAs: "followUp", triggerTurn: true },
					);
					continue;
				}

				const result = await runEntry(entry, ctx.cwd, pi);

				debugLog.log("agent_check", "Check completed", {
					type: entry.type,
					label,
					exitCode: result.exitCode,
					elapsedMs: result.elapsed,
				});

				if (result.exitCode !== 0) {
					const output = result.stderr || result.stdout;
					const failurePrompt = entry.failurePrompt || DEFAULT_CHECKS_FAILURE_PROMPT;
					failures.push(
						`**${label}** failed (exit code ${result.exitCode}):\n\n\`\`\`\n${output}\n\`\`\`\n\n${failurePrompt}`,
					);
				}
			}

			if (failures.length > 0) {
				const message = `Badger checks failed:\n\n${failures.join("\n\n")}`;
				debugLog.log("agent_check", "Checks failed", {
					failureCount: failures.length,
				});
				pi.sendMessage(
					{
						customType: "badger-check-failure",
						content: message,
						display: true,
					},
					{ deliverAs: "steer", triggerTurn: true },
				);
				return;
			}

			debugLog.log("agent_check", "All checks passed", {
				fileCount: state.lastRunHashMap.size,
			});

			ctx.ui.notify("✓ All checks passed", "info");

			// Run release if configured
			if (state.config.release) {
				state.isRunningRelease = true;
				debugLog.log("agent_release", "Starting release");

				try {
					const result = await runEntry(state.config.release, ctx.cwd, pi);
					const label = entryLabel(state.config.release);

					if (result.exitCode !== 0) {
						const output = result.stderr || result.stdout;
						const failurePrompt = state.config.release.failurePrompt || DEFAULT_RELEASE_FAILURE_PROMPT;
						ctx.ui.notify("✗ Release failed", "error");
						debugLog.log("agent_release", "Release failed", {
							exitCode: result.exitCode,
						});
						pi.sendMessage(
							{
								customType: "badger-release-failure",
								content: `Badger release failed (${label}):\n\n\`\`\`\n${output}\n\`\`\`\n\n${failurePrompt}`,
								display: true,
							},
							{ triggerTurn: false },
						);
					} else {
						ctx.ui.notify("✓ Released successfully", "info");
						debugLog.log("agent_release", "Release succeeded");
					}
				} finally {
					state.isRunningRelease = false;
				}
			}
		} finally {
			state.isRunningChecks = false;
		}
	});
}