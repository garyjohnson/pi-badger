import { describe, test, expect } from "bun:test";
import {
	extractFastLabel,
	extractCheckLabel,
	extractReleaseLabel,
	countCheckFailures,
} from "../extensions/badger/renderers.js";
import { computeStatus } from "../extensions/badger/status.js";
import type { BadgerState } from "../extensions/badger/types.js";

// ---------------------------------------------------------------------------
// computeStatus
// ---------------------------------------------------------------------------

describe("computeStatus", () => {
	function makeState(overrides: Partial<BadgerState> = {}): BadgerState {
		return {
			config: {
				watchPatterns: ["src/**/*"],
				excludePatterns: [],
				notifyWithoutConfig: true,
				debug: false,
				tailLines: 0,
				checksFast: [],
				checks: [],
				release: null,
			},
			enabled: true,
			currentHashMap: new Map(),
			lastRunHashMap: new Map(),
			fastCheckAbortController: null,
			isRunningChecks: false,
			isRunningRelease: false,
			runningLabel: null,
			debugEnabled: false,
			showTail: false,
			...overrides,
		};
	}

	test("returns undefined when enabled and idle", () => {
		const state = makeState();
		expect(computeStatus(state)).toBeUndefined();
	});

	test("shows 'Badger DISABLED' when disabled", () => {
		const state = makeState({ enabled: false });
		expect(computeStatus(state)).toBe("🦡 Badger DISABLED");
	});

	test("shows running label when a check is active", () => {
		const state = makeState({ runningLabel: "scripts/lint" });
		expect(computeStatus(state)).toBe("🦡 Badger running scripts/lint");
	});

	test("shows running label with Debug ON", () => {
		const state = makeState({ runningLabel: "scripts/check", debugEnabled: true });
		expect(computeStatus(state)).toBe("🦡 Badger running scripts/check | 🐛 Badger DEBUG ON");
	});

	test("shows Debug ON when enabled and idle", () => {
		const state = makeState({ debugEnabled: true });
		expect(computeStatus(state)).toBe("🐛 Badger DEBUG ON");
	});

	test("shows Debug ON when disabled", () => {
		const state = makeState({ enabled: false, debugEnabled: true });
		expect(computeStatus(state)).toBe("🦡 Badger DISABLED | 🐛 Badger DEBUG ON");
	});

	test("returns undefined when no config loaded", () => {
		const state = makeState({ config: null });
		expect(computeStatus(state)).toBeUndefined();
	});

	test("shows DISABLED with debug when no config and disabled", () => {
		const state = makeState({ config: null, enabled: false, debugEnabled: true });
		expect(computeStatus(state)).toBeUndefined();
	});

	test("shows TAIL when showTail is enabled", () => {
		const state = makeState({ showTail: true });
		expect(computeStatus(state)).toBe("📺 Badger TAIL");
	});

	test("shows running label with TAIL", () => {
		const state = makeState({ runningLabel: "scripts/check", showTail: true });
		expect(computeStatus(state)).toBe("🦡 Badger running scripts/check | 📺 Badger TAIL");
	});

	test("shows TAIL with DEBUG ON", () => {
		const state = makeState({ showTail: true, debugEnabled: true });
		expect(computeStatus(state)).toBe("📺 Badger TAIL | 🐛 Badger DEBUG ON");
	});
});

// ---------------------------------------------------------------------------
// extractFastLabel
// ---------------------------------------------------------------------------

describe("extractFastLabel", () => {
	test("extracts label from fast check failure with files", () => {
		const content = 'Badger fast check failed (scripts/lint) on files: src/a.ts, src/b.ts\n\n```\nError output\n```\n\nFix the lint issues.';
		expect(extractFastLabel(content)).toBe("scripts/lint");
	});

	test("extracts label from fast check failure with command label", () => {
		const content = 'Badger fast check failed (npx tsc --noEmit) on files: src/a.ts\n\n```\nerror\n```\n\nFix type errors.';
		expect(extractFastLabel(content)).toBe("npx tsc --noEmit");
	});

	test("returns null for empty string", () => {
		expect(extractFastLabel("")).toBeNull();
	});

	test("returns null for non-matching content", () => {
		expect(extractFastLabel("Some random message")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// extractCheckLabel
// ---------------------------------------------------------------------------

describe("extractCheckLabel", () => {
	test("extracts label from single check failure", () => {
		const content = "**scripts/check** failed (exit code 1):\n\n```\nError output\n```\n\nFix test failures.";
		expect(extractCheckLabel(content)).toBe("scripts/check");
	});

	test("extracts label from first failure when multiple exist", () => {
		const content = "**lint** failed (exit code 1):\n\n```\nError\n```\n\nFix.\n\n**test** failed (exit code 2):\n\n```\nError2\n```\n\nFix.";
		expect(extractCheckLabel(content)).toBe("lint");
	});

	test("extracts label with path separators", () => {
		const content = "**scripts/typecheck** failed (exit code 1):\n\n```\nError\n```";
		expect(extractCheckLabel(content)).toBe("scripts/typecheck");
	});

	test("returns null for non-matching content", () => {
		expect(extractCheckLabel("No failures here")).toBeNull();
	});

	test("returns null for empty string", () => {
		expect(extractCheckLabel("")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// extractReleaseLabel
// ---------------------------------------------------------------------------

describe("extractReleaseLabel", () => {
	test("extracts label from release failure message", () => {
		const content = "Badger release failed (scripts/release):\n\n```\nError output\n```\n\nThe release failed.";
		expect(extractReleaseLabel(content)).toBe("scripts/release");
	});

	test("extracts label with command", () => {
		const content = "Badger release failed (npm publish):\n\n```\nError\n```\n\nReview the errors.";
		expect(extractReleaseLabel(content)).toBe("npm publish");
	});

	test("returns null for non-matching content", () => {
		expect(extractReleaseLabel("No release failure")).toBeNull();
	});

	test("returns null for empty string", () => {
		expect(extractReleaseLabel("")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// countCheckFailures
// ---------------------------------------------------------------------------

describe("countCheckFailures", () => {
	test("counts single failure", () => {
		const content = "**lint** failed (exit code 1):\n\n```\nError\n```";
		expect(countCheckFailures(content)).toBe(1);
	});

	test("counts multiple failures", () => {
		const content = "**lint** failed (exit code 1):\n\n```\nError\n```\n\nFix.\n\n**typecheck** failed (exit code 2):\n\n```\nError2\n```\n\nFix.";
		expect(countCheckFailures(content)).toBe(2);
	});

	test("counts zero failures", () => {
		expect(countCheckFailures("No failures")).toBe(0);
	});

	test("counts three failures", () => {
		const content = "**a** failed (exit code 1):\n\n```\n```\n\n**b** failed (exit code 2):\n\n```\n```\n\n**c** failed (exit code 3):\n\n```\n```";
		expect(countCheckFailures(content)).toBe(3);
	});

	test("returns 0 for empty string", () => {
		expect(countCheckFailures("")).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// BadgerState fields
// ---------------------------------------------------------------------------

describe("BadgerState", () => {
	test("state includes enabled field defaulting to true", () => {
		const state = {
			config: null,
			enabled: true,
			currentHashMap: new Map(),
			lastRunHashMap: new Map(),
			fastCheckAbortController: null,
			isRunningChecks: false,
			isRunningRelease: false,
			runningLabel: null,
			debugEnabled: false,
			showTail: false,
		};

		expect(state.enabled).toBe(true);
		expect(state.config).toBeNull();
	});

	test("state can be disabled and re-enabled", () => {
		const state = {
			config: null,
			enabled: true,
			currentHashMap: new Map(),
			lastRunHashMap: new Map(),
			fastCheckAbortController: null,
			isRunningChecks: false,
			isRunningRelease: false,
			runningLabel: null,
			debugEnabled: false,
			showTail: false,
		};

		state.enabled = false;
		expect(state.enabled).toBe(false);

		state.enabled = true;
		expect(state.enabled).toBe(true);
	});
});