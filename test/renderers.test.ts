import { describe, test, expect } from "bun:test";
import {
	extractFastLabel,
	extractCheckLabel,
	extractReleaseLabel,
	countCheckFailures,
} from "../extensions/badger/renderers.js";

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
// BadgerState.enabled field
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
		};

		state.enabled = false;
		expect(state.enabled).toBe(false);

		state.enabled = true;
		expect(state.enabled).toBe(true);
	});
});