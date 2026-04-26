/**
 * Badger — Shared check runner with optional tail overlay
 *
 * Used by both automatic (agent_end) and manual (/badger:check)
 * check execution to ensure the tail overlay works consistently.
 */

import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { BadgerState, CheckEntry, RunResult } from "./types.js";
import { DebugLogger } from "./debug-logger.js";
import { runEntry, entryLabel } from "./runner.js";
import { TailOverlay, runWithTailOverlay, type StreamedRunResult } from "./tail-overlay.js";
import { startStatusTimer, stopStatusTimer } from "./status.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Determine the shell command for a check entry (for tail overlay streaming). */
function getCommandForEntry(entry: CheckEntry, cwd: string): string | null {
	if (entry.type === "command" && entry.command) return entry.command;
	if (entry.type === "script" && entry.path) return path.resolve(cwd, entry.path);
	return null;
}

// ---------------------------------------------------------------------------
// Single entry runner
// ---------------------------------------------------------------------------

/** Run a single check entry, using tail overlay when showTail is enabled and UI is available. */
export async function runCheckEntryWithOptionalTail(
	entry: CheckEntry,
	cwd: string,
	pi: ExtensionAPI,
	state: BadgerState,
	debugLog: DebugLogger,
	syncStatusFn: (state: BadgerState, ui: { setStatus: (key: string, value: string | undefined) => void }) => void,
	ctx: ExtensionContext,
	category: string,
): Promise<RunResult> {
	const label = entryLabel(entry);

	// Prompt entries are fire-and-forget
	if (entry.type === "prompt" && entry.content) {
		debugLog.log(category, "Sending prompt entry", {
			contentLength: entry.content.length,
			contentPreview: entry.content.slice(0, 200),
		});
		pi.sendMessage(
			{
				customType: `badger-${category}-prompt`,
				content: entry.content,
				display: true,
			},
			{ deliverAs: "followUp", triggerTurn: true },
		);
		return { exitCode: 0, stdout: "", stderr: "", aborted: false };
	}

	state.runningLabel = label;
	state.runningStartTime = Date.now();
	startStatusTimer(state, ctx.ui);
	ctx.ui.notify(`🦡 Running ${label}...`, "info");

	try {
		const shouldTail = state.showTail && entry.type !== "prompt";
		const command = getCommandForEntry(entry, cwd);

		if (shouldTail && ctx.hasUI && command) {
			// Run with streaming tail overlay
			const tailLineCount = state.config?.tailLines ?? 15;
			const maxVisibleLines = Math.max(5, Math.min(tailLineCount, 30));

			const result = await ctx.ui.custom<StreamedRunResult | null>((tui, theme, _kb, done) => {
				const overlay = new TailOverlay(label, maxVisibleLines, theme, () => done(null));

				runWithTailOverlay(command, cwd, overlay, tui, done);

				return overlay;
			}, {
				overlay: true,
				overlayOptions: {
					anchor: "bottom-right",
					width: "60%",
					minWidth: 40,
					margin: 1,
				},
			});

			if (result === null) {
				// Overlay was dismissed — treat as user abort
				debugLog.log(category, "Overlay dismissed by user", { label });
				return { exitCode: -1, stdout: "", stderr: "Aborted by user", aborted: true };
			}

			debugLog.log(category, "Check completed (with tail)", {
				type: entry.type,
				label,
				exitCode: result.exitCode,
				elapsedMs: result.elapsed,
			});

			return result;
		}

		// Standard non-streaming run (fallback)
		const result = await runEntry(entry, cwd, pi);

		debugLog.log(category, "Check completed", {
			type: entry.type,
			label,
			exitCode: result.exitCode,
			elapsedMs: result.elapsed,
			stdoutLength: result.stdout.length,
			stderrLength: result.stderr.length,
			stdout: result.stdout.length <= 500 ? result.stdout : result.stdout.slice(0, 500) + "...[truncated]",
			stderr: result.stderr.length <= 500 ? result.stderr : result.stderr.slice(0, 500) + "...[truncated]",
		});

		return result;
	} finally {
		state.runningLabel = null;
		state.runningStartTime = null;
		stopStatusTimer(state);
		syncStatusFn(state, ctx.ui);
	}
}