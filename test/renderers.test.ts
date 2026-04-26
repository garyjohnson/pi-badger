import { describe, test, expect } from "bun:test";
import {
	extractFastLabel,
	extractCheckLabel,
	extractReleaseLabel,
	countCheckFailures,
	formatCheckFailure,
	formatSingleFailureMessage,
	formatMultiFailureMessage,
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
				debug: false,
				tailLines: 0,
				showTail: true,
				fastFail: true,
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

	// Note: showTail is no longer displayed in the status bar
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
		const state: BadgerState = {
			config: null,
			enabled: true,
			currentHashMap: new Map(),
			lastRunHashMap: new Map(),
			fastCheckAbortController: null,
			isRunningChecks: false,
			isRunningRelease: false,
			runningLabel: null,
			runningStartTime: null,
			debugEnabled: false,
			showTail: true,
			fastFail: true,
		};

		expect(state.enabled).toBe(true);
		expect(state.config).toBeNull();
	});

	test("state can be disabled and re-enabled", () => {
		const state: BadgerState = {
			config: null,
			enabled: true,
			currentHashMap: new Map(),
			lastRunHashMap: new Map(),
			fastCheckAbortController: null,
			isRunningChecks: false,
			isRunningRelease: false,
			runningLabel: null,
			runningStartTime: null,
			debugEnabled: false,
			showTail: true,
			fastFail: true,
		};

		state.enabled = false;
		expect(state.enabled).toBe(false);

		state.enabled = true;
		expect(state.enabled).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Failure message formatting
// ---------------------------------------------------------------------------

describe("formatCheckFailure", () => {
	test("formats a single check failure", () => {
		const result = formatCheckFailure({
			label: "scripts/lint",
			exitCode: 1,
			output: "2 errors found",
			failurePrompt: "Fix the lint issues.",
		});
		expect(result).toContain("**scripts/lint** failed (exit code 1):");
		expect(result).toContain("2 errors found");
		expect(result).toContain("Fix the lint issues.");
	});

	test("includes code block around output", () => {
		const result = formatCheckFailure({
			label: "scripts/check",
			exitCode: 2,
			output: "FAIL test/foo.test.ts",
			failurePrompt: "Fix tests.",
		});
		expect(result).toContain("```\nFAIL test/foo.test.ts\n```");
	});
});

describe("formatSingleFailureMessage", () => {
	test("formats a single-failure message (fastFail: true)", () => {
		const message = formatSingleFailureMessage({
			label: "scripts/lint",
			exitCode: 1,
			output: "Lint error",
			failurePrompt: "Fix lint.",
		});
		expect(message).toBe(
			"Badger checks failed:\n\n**scripts/lint** failed (exit code 1):\n\n```\nLint error\n```\n\nFix lint.",
		);
	});

	test("message is parseable by extractCheckLabel", () => {
		const message = formatSingleFailureMessage({
			label: "scripts/typecheck",
			exitCode: 1,
			output: "Type error",
			failurePrompt: "Fix types.",
		});
		expect(extractCheckLabel(message)).toBe("scripts/typecheck");
		expect(countCheckFailures(message)).toBe(1);
	});
});

describe("formatMultiFailureMessage", () => {
		test("formats a multi-failure message (fastFail: false)", () => {
		const message = formatMultiFailureMessage([
			{ label: "scripts/lint", exitCode: 1, output: "Lint error", failurePrompt: "Fix lint." },
			{ label: "scripts/check", exitCode: 2, output: "Test error", failurePrompt: "Fix tests." },
		]);
		expect(message).toBe(
			"Badger checks failed:\n\n**scripts/lint** failed (exit code 1):\n\n```\nLint error\n```\n\nFix lint.\n\n**scripts/check** failed (exit code 2):\n\n```\nTest error\n```\n\nFix tests.",
		);
	});

	test("message with two failures is parseable by extractCheckLabel and countCheckFailures", () => {
		const message = formatMultiFailureMessage([
			{ label: "scripts/lint", exitCode: 1, output: "E1", failurePrompt: "Fix lint." },
			{ label: "scripts/check", exitCode: 2, output: "E2", failurePrompt: "Fix tests." },
		]);
		expect(extractCheckLabel(message)).toBe("scripts/lint");
		expect(countCheckFailures(message)).toBe(2);
	});

	test("message with three failures is parseable", () => {
		const message = formatMultiFailureMessage([
			{ label: "lint", exitCode: 1, output: "E1", failurePrompt: "F1" },
			{ label: "typecheck", exitCode: 2, output: "E2", failurePrompt: "F2" },
			{ label: "check", exitCode: 3, output: "E3", failurePrompt: "F3" },
		]);
		expect(countCheckFailures(message)).toBe(3);
	});

	test("single-failure array produces same format as formatSingleFailureMessage", () => {
		const single = formatSingleFailureMessage({
			label: "scripts/lint",
			exitCode: 1,
			output: "Error",
			failurePrompt: "Fix.",
		});
		const multi = formatMultiFailureMessage([
			{ label: "scripts/lint", exitCode: 1, output: "Error", failurePrompt: "Fix." },
		]);
		expect(single).toBe(multi);
	});

	test("throws on empty array", () => {
		expect(() => formatMultiFailureMessage([])).toThrow("formatMultiFailureMessage requires at least one failure");
	});
});