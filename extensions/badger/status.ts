/**
 * Badger — Status bar computation
 *
 * Builds a single consolidated status string from Badger state,
 * combining enabled/running/debug indicators into one status bar entry.
 */

import type { BadgerState } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Format milliseconds into M:SS or H:MM:SS string.
 *  Clamp negative values to 0:00 to avoid garbled display from clock skew.
 */
function formatElapsed(ms: number): string {
	if (ms < 0) ms = 0;
	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	}
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Compute the Badger status bar string.
 *
 * Visibility rules:
 *   - Always show the currently running check (if any).
 *   - Only show "DISABLED" when Badger is disabled.
 *   - Only show "🐛 Badger DEBUG ON" when debug mode is enabled.
 *   - Show nothing when Badger is enabled and idle.
 *
 * Format examples:
 *   "🦡 Badger running scripts/lint"
 *   "🦡 Badger running scripts/check"
 *   "🦡 Badger DISABLED"
 *   "🦡 Badger DISABLED | 🐛 Badger DEBUG ON"
 *   "🐛 Badger DEBUG ON"
 *   undefined  (enabled and idle, debug off)
 */
export function computeStatus(state: BadgerState): string | undefined {
	if (!state.config) return undefined;

	const parts: string[] = [];

	if (!state.enabled) {
		parts.push("🦡 Badger DISABLED");
	}

	if (state.runningLabel) {
		let label = `🦡 Badger running ${state.runningLabel}`;
		if (state.runningStartTime) {
			const elapsed = Date.now() - state.runningStartTime;
			label += ` ${formatElapsed(elapsed)}`;
		}
		parts.push(label);
	}

	if (state.debugEnabled) {
		parts.push("🐛 Badger DEBUG ON");
	}

	if (parts.length === 0) return undefined;

	return parts.join(" | ");
}

// ---------------------------------------------------------------------------
// Status timer — periodically refresh the status bar to tick the elapsed time
// ----------------------------------------------------------------------------

/** Start a 1-second interval that re-computes and sets the status bar string.
 *  Call this when `runningLabel`/`runningStartTime` are set.
 *  Safe to call if a timer is already running — it will clear the old one first.
 */
export function startStatusTimer(
	state: BadgerState,
	ui: { setStatus: (key: string, value: string | undefined) => void },
): void {
	stopStatusTimer(state);
	state.statusTimer = setInterval(() => {
		ui.setStatus("badger", computeStatus(state));
	}, 1000);
}

/** Stop the status bar refresh timer.
 *  Call this when `runningLabel`/`runningStartTime` are cleared.
 */
export function stopStatusTimer(state: BadgerState): void {
	if (state.statusTimer) {
		clearInterval(state.statusTimer);
		state.statusTimer = null;
	}
}
