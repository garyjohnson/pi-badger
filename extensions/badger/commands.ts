/**
 * Badger — Command registration (/badger:setup, /badger:check, /badger:release, /badger:debug, /badger:enable, /badger:disable, /badger:tail)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { BadgerState, CheckEntry, RunResult } from "./types.js";
import { loadConfig, saveConfig, DEFAULT_CHECKS_FAILURE_PROMPT, DEFAULT_RELEASE_FAILURE_PROMPT } from "./config.js";
import { formatSingleFailureMessage, formatMultiFailureMessage, type CheckFailure } from "./renderers.js";
import { DebugLogger } from "./debug-logger.js";
import { buildHashMap, rebuildHashMap, diffHashMaps, diffFilePaths } from "./file-watcher.js";
import { runEntry, entryLabel } from "./runner.js";
import { runCheckEntryWithOptionalTail } from "./check-runner.js";
import { startStatusTimer, stopStatusTimer } from "./status.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a sequence of check entries, collecting failures. */
// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerCommands(
	pi: ExtensionAPI,
	state: BadgerState,
	debugLog: () => DebugLogger,
	syncStatus: (state: BadgerState, ui: { setStatus: (key: string, value: string | undefined) => void }) => void,
): void {

	// -----------------------------------------------------------------------
	// /badger:setup — configure Badger for this project
	// -----------------------------------------------------------------------
	pi.registerCommand("badger:setup", {
		description: "Configure Badger quality gate for this project",
		handler: async (_args, ctx) => {
			const skillPath = path.join(__dirname, "..", "skills", "badger-setup", "SKILL.md");
			let skillContent: string;
			try {
				skillContent = fs.readFileSync(skillPath, "utf-8");
			} catch {
				skillContent = `Analyze this project and create Badger configuration:

1. Detect the language, test framework, linter, and build tools
2. Create \`.pi/badger.json\` with appropriate watchPatterns, excludePatterns, checksFast, checks, and release settings
3. Create executable check scripts in \`scripts/\` — one per fast check (lint, typecheck, test_changed), plus check and release
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
	// /badger:enable — enable Badger auto-checks
	// -----------------------------------------------------------------------
	pi.registerCommand("badger:enable", {
		description: "Enable Badger automatic checks and release",
		handler: async (_args, ctx) => {
			if (!state.config) {
				ctx.ui.notify(
					"Badger is not configured. Run /badger:setup first.",
					"warning",
				);
				return;
			}

			state.enabled = true;
			// Rebuild hash maps to current state so we don't trigger stale checks
			state.currentHashMap = buildHashMap(
				state.configDir ?? ctx.cwd,
				state.config.watchPatterns,
				state.config.excludePatterns,
			);
			state.lastRunHashMap = new Map(state.currentHashMap);

			const fileCount = state.currentHashMap.size;
			ctx.ui.notify(`🦡 Badger enabled — watching ${fileCount} file(s)`, "info");

			const log = debugLog();
			log.log("enable", "Badger enabled via /badger:enable command", {
				fileCount,
			});
			syncStatus(state, ctx.ui);
		},
	});

	// -----------------------------------------------------------------------
	// /badger:disable — disable Badger auto-checks
	// -----------------------------------------------------------------------
	pi.registerCommand("badger:disable", {
		description: "Disable Badger automatic checks and release",
		handler: async (_args, ctx) => {
			if (!state.config) {
				ctx.ui.notify(
					"Badger is not configured. Run /badger:setup first.",
					"warning",
				);
				return;
			}

			// Abort any in-flight fast checks
			if (state.fastCheckAbortController) {
				state.fastCheckAbortController.abort();
			}

			state.enabled = false;
			syncStatus(state, ctx.ui);
			ctx.ui.notify("🦡 Badger disabled — automatic checks paused", "info");

			const log = debugLog();
			log.log("disable", "Badger disabled via /badger:disable command");
		},
	});

	// -----------------------------------------------------------------------
	// /badger:check — manually trigger full checks
	// -----------------------------------------------------------------------
	pi.registerCommand("badger:check", {
		description: "Manually trigger Badger checks",
		handler: async (_args, ctx) => {
			if (!state.config) {
				ctx.ui.notify(
					"Badger is not configured. Run /badger:setup first.",
					"warning",
				);
				return;
			}

			const log = debugLog();
			log.log("manual_check", "Manually triggered full checks");

			state.isRunningChecks = true;
			try {
				const failures: CheckFailure[] = [];

				for (const entry of state.config.checks) {
					const result = await runCheckEntryWithOptionalTail(
						entry, state.configDir ?? ctx.cwd, pi, state, log, syncStatus, ctx, "manual_check",
					);

					// If user dismissed overlay, skip this entry
					if (result.aborted && result.exitCode === -1) {
						log.log("manual_check", "Entry skipped (overlay dismissed)", {
							label: entryLabel(entry),
						});
						continue;
					}

					if (result.exitCode !== 0) {
						const output = result.stderr || result.stdout;
						const failurePrompt = entry.failurePrompt || DEFAULT_CHECKS_FAILURE_PROMPT;
						log.log("manual_check", "Check failed", {
							label: entryLabel(entry),
							type: entry.type,
							exitCode: result.exitCode,
							output: output.slice(0, 1000),
						});

						if (state.fastFail) {
							const message = formatSingleFailureMessage({ label: entryLabel(entry), exitCode: result.exitCode, output, failurePrompt });
							pi.sendMessage(
								{
									customType: "badger-check-failure",
									content: message,
									display: true,
								},
								{ triggerTurn: true },
							);
							return; // Short-circuit on first failure
						} else {
							failures.push({ label: entryLabel(entry), exitCode: result.exitCode, output, failurePrompt });
							continue;
						}
					}
				}

				// Handle collected failures when fastFail is disabled
				if (failures.length > 0) {
					const message = formatMultiFailureMessage(failures);
					log.log("manual_check", "Multiple checks failed", {
						failureCount: failures.length,
						labels: failures.map(f => f.label),
					});
					pi.sendMessage(
						{
							customType: "badger-check-failure",
							content: message,
							display: true,
						},
						{ triggerTurn: true },
					);
					return;
				}

				ctx.ui.notify("✓ All checks passed", "info");
				log.log("manual_check", "All checks passed");

				state.lastRunHashMap = buildHashMap(
					state.configDir ?? ctx.cwd,
					state.config.watchPatterns,
					state.config.excludePatterns,
				);
			} finally {
				state.isRunningChecks = false;
			}
		},
	});

	// -----------------------------------------------------------------------
	// /badger:release — manually trigger release
	// -----------------------------------------------------------------------
	pi.registerCommand("badger:release", {
		description: "Manually trigger Badger release",
		handler: async (_args, ctx) => {
			if (!state.config) {
				ctx.ui.notify(
					"Badger is not configured. Run /badger:setup first.",
					"warning",
				);
				return;
			}

			if (!state.config.release) {
				ctx.ui.notify("No release step configured.", "warning");
				return;
			}

			const log = debugLog();
			log.log("manual_release", "Manually triggered release");

			state.isRunningRelease = true;
			try {
				// Use shared runner for both prompts and script/command entries
				const result = await runCheckEntryWithOptionalTail(
					state.config.release,
					state.configDir ?? ctx.cwd,
					pi,
					state,
					log,
					syncStatus,
					ctx,
					"manual_release",
					{ deliverAs: "steer" },
				);

				// Prompt entries are fire-and-forget — don't show success message
				if (state.config.release.type === "prompt" && state.config.release.content) {
					// No success message for prompts
				} else if (result.exitCode !== 0) {
					const failurePrompt = state.config.release.failurePrompt || DEFAULT_RELEASE_FAILURE_PROMPT;
					ctx.ui.notify("✗ Release failed", "error");
					pi.sendMessage(
						{
							customType: "badger-release-failure",
							content: `Badger release failed (${entryLabel(state.config.release)}):\n\n\`\`\`\n${result.stderr || result.stdout}\n\`\`\`\n\n${failurePrompt}`,
							display: true,
						},
						{ triggerTurn: false },
					);
				} else {
					ctx.ui.notify("✓ Released successfully", "info");
				}
			} finally {
				state.isRunningRelease = false;
			}
		},
	});

	// -----------------------------------------------------------------------
	// /badger:debug — toggle debug mode, view log, clear log, show status
	// -----------------------------------------------------------------------
	pi.registerCommand("badger:debug", {
		description: "Toggle Badger debug mode. Use 'on'/'off' to toggle, 'log' to view, 'clear' to clear log",
		handler: async (args, ctx) => {
			const subcommand = (args || "").trim().toLowerCase();

			if (!state.config) {
				ctx.ui.notify(
					"Badger is not configured. Run /badger:setup first.",
					"warning",
				);
				return;
			}

			const log = debugLog();

			if (subcommand === "off") {
				log.setEnabled(false, state.configDir ?? ctx.cwd);
				state.config.debug = false;
				state.debugEnabled = false;
				saveConfig(ctx.cwd, state.config);
				syncStatus(state, ctx.ui);
				ctx.ui.notify("🐛 Badger debug mode OFF", "info");
				return;
			}

			if (subcommand === "clear") {
				log.clearLog();
				ctx.ui.notify("🐛 Debug log cleared", "info");
				return;
			}

			if (subcommand === "log") {
				const content = log.getLogContent();
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
					`  Enabled: ${log.isEnabled}`,
					`  Badger active: ${state.enabled}`,
					`  Log path: ${log.getLogPath()}`,
					`  Watch patterns: ${state.config.watchPatterns.join(", ")}`,
					`  Exclude patterns: ${state.config.excludePatterns.join(", ") || "(none)"}`,
					`  Files tracked: ${state.currentHashMap.size}`,
					`  Last-run files: ${state.lastRunHashMap.size}`,
					`  Fast checks: ${state.config.checksFast.length} entries`,
					`  Full checks: ${state.config.checks.length} entries`,
					`  Has release: ${!!state.config.release}`,
					`  Running checks: ${state.isRunningChecks}`,
					`  Running release: ${state.isRunningRelease}`,
					`  Tail overlay: ${state.showTail ? "ON" : "OFF"}`,
					`  Fast fail: ${state.fastFail ? "ON" : "OFF"}`,
				];

				// Compute pending changes since last pass
				if (state.currentHashMap.size > 0) {
					const changes = diffHashMaps(state.lastRunHashMap, state.currentHashMap);
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
			if (!log.isEnabled) {
				log.setEnabled(true, state.configDir ?? ctx.cwd);
				state.config.debug = true;
				state.debugEnabled = true;
				saveConfig(ctx.cwd, state.config);
				syncStatus(state, ctx.ui);
				log.log("debug", "Debug mode enabled via /badger:debug command");
				ctx.ui.notify("🐛 Badger debug mode ON — logging to .pi/badger-debug.log", "info");
			} else {
				log.setEnabled(false, state.configDir ?? ctx.cwd);
				state.config.debug = false;
				state.debugEnabled = false;
				saveConfig(ctx.cwd, state.config);
				syncStatus(state, ctx.ui);
				ctx.ui.notify("🐛 Badger debug mode OFF", "info");
			}
		},
	});

	// -----------------------------------------------------------------------
	// /badger:tail — toggle tail overlay for full checks
	// -----------------------------------------------------------------------
	pi.registerCommand("badger:tail", {
		description: "Toggle tail overlay for full checks. Use 'on'/'off' to toggle, or run without args to toggle.",
		handler: async (args, ctx) => {
			const subcommand = (args || "").trim().toLowerCase();

			if (!state.config) {
				ctx.ui.notify(
					"Badger is not configured. Run /badger:setup first.",
					"warning",
				);
				return;
			}

			if (subcommand === "on") {
				state.showTail = true;
				// Set a default tailLines value if not already set
				if (state.config.tailLines === 0) {
					state.config.tailLines = 20;
				}
				saveConfig(ctx.cwd, state.config);
				syncStatus(state, ctx.ui);
				ctx.ui.notify("🦡 Badger tail overlay ON — full checks will show live output", "info");
			} else if (subcommand === "off") {
				state.showTail = false;
				saveConfig(ctx.cwd, state.config);
				syncStatus(state, ctx.ui);
				ctx.ui.notify("🦡 Badger tail overlay OFF", "info");
			} else {
				// Toggle
				state.showTail = !state.showTail;
				// Set a default tailLines value if not already set and enabling
				if (state.showTail && state.config.tailLines === 0) {
					state.config.tailLines = 20;
				}
				saveConfig(ctx.cwd, state.config);
				syncStatus(state, ctx.ui);
				ctx.ui.notify(
					state.showTail
						? "🦡 Badger tail overlay ON — full checks will show live output"
						: "🦡 Badger tail overlay OFF",
					"info",
				);
			}
		},
	});
}