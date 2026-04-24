/**
 * Badger — Status bar computation
 *
 * Builds a single consolidated status string from Badger state,
 * combining enabled/running/debug indicators into one status bar entry.
 */

import type { BadgerState } from "./types.js";

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
 *   "🦡 Badger running scripts/lint | 🐛 Badger DEBUG ON"
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
		parts.push(`🦡 Badger running ${state.runningLabel}`);
	}

	if (state.debugEnabled) {
		parts.push("🐛 Badger DEBUG ON");
	}

	if (parts.length === 0) return undefined;

	return parts.join(" | ");
}