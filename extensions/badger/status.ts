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
 * Format examples:
 *   "🦡 Badger running scripts/lint | 🐛 Debug ON"
 *   "🦡 Badger ON | 🐛 Debug ON"
 *   "🦡 Badger DISABLED | 🐛 Debug ON"
 *   "🦡 Badger running scripts/check"
 *   "🦡 Badger ON"
 *   "🦡 Badger DISABLED"
 */
export function computeStatus(state: BadgerState): string | undefined {
	if (!state.config) return undefined;

	const parts: string[] = [];

	if (!state.enabled) {
		parts.push("🦡 Badger DISABLED");
	} else if (state.runningLabel) {
		parts.push(`🦡 Badger running ${state.runningLabel}`);
	} else {
		parts.push("🦡 Badger ON");
	}

	if (state.debugEnabled) {
		parts.push("🐛 Debug ON");
	}

	return parts.join(" | ");
}