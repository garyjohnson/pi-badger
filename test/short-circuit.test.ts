import { describe, test, expect } from "bun:test";
import { extractCheckLabel, countCheckFailures } from "../extensions/badger/renderers.js";

/**
 * Tests for short-circuit behavior in full checks (checks).
 * When fastFail is true (default), Badger short-circuits and reports only the first failure.
 * When fastFail is false, all failures are collected and reported together.
 * These tests verify both message formats.
 *
 * Config loading tests for fastFail are in config.test.ts.
 * Formatting function tests for fastFail are in renderers.test.ts.
 */

describe("short-circuit single failure message format", () => {
	test("extractCheckLabel extracts label from single short-circuit failure", () => {
		// This is the new format used when short-circuiting on first failure
		const message = `Badger checks failed:

**scripts/check** failed (exit code 1):

\`\`\`
Error: test failed
\`\`\`

Fix the test failures and continue working.`;

		expect(extractCheckLabel(message)).toBe("scripts/check");
	});

	test("extractCheckLabel extracts label from single failure with command type", () => {
		const message = `Badger checks failed:

**npx vitest run** failed (exit code 1):

\`\`\`
FAIL tests/foo.test.ts
\`\`\`

Fix the test failures and continue working.`;

		expect(extractCheckLabel(message)).toBe("npx vitest run");
	});

	test("countCheckFailures returns 1 for single short-circuit failure", () => {
		const message = `Badger checks failed:

**scripts/check** failed (exit code 1):

\`\`\`
Error: test failed
\`\`\`

Fix the test failures and continue working.`;

		expect(countCheckFailures(message)).toBe(1);
	});

	test("short-circuit failure message correctly renders in badge", () => {
		// Verify the format that the renderer expects
		// Renderer shows: "☠ scripts/check" when count === 1
		const message = `Badger checks failed:

**scripts/lint** failed (exit code 1):

\`\`\`
Lint errors found
\`\`\`

Fix the lint issues.`;

		const label = extractCheckLabel(message);
		const count = countCheckFailures(message);

		expect(label).toBe("scripts/lint");
		expect(count).toBe(1);
	});

	test("old multi-failure format still counts correctly (for backwards compatibility)", () => {
		// This is the old format that collected multiple failures
		const message = `Badger checks failed:

**lint** failed (exit code 1):

\`\`\`
Error
\`\`\`

Fix.

**test** failed (exit code 2):

\`\`\`
Error2
\`\`\`

Fix.`;

		expect(countCheckFailures(message)).toBe(2);
		expect(extractCheckLabel(message)).toBe("lint");
	});
});

// ---------------------------------------------------------------------------
// Multi-failure message format (fastFail: false)
// ---------------------------------------------------------------------------

describe("multi-failure message format (fastFail: false)", () => {
	test("extractCheckLabel extracts first label from multi-failure message", () => {
		const message = `Badger checks failed:

**scripts/lint** failed (exit code 1):

\`\`\`
Lint error
\`\`\`

Fix lint.

**scripts/check** failed (exit code 2):

\`\`\`
Test error
\`\`\`

Fix tests.`;

		expect(extractCheckLabel(message)).toBe("scripts/lint");
	});

	test("countCheckFailures counts all failures in multi-failure message", () => {
		const message = `Badger checks failed:

**scripts/lint** failed (exit code 1):

\`\`\`
Lint error
\`\`\`

Fix lint.

**scripts/check** failed (exit code 2):

\`\`\`
Test error
\`\`\`

Fix tests.`;

		expect(countCheckFailures(message)).toBe(2);
	});

	test("countCheckFailures counts three failures in multi-failure message", () => {
		const message = `Badger checks failed:

**lint** failed (exit code 1):

\`\`\`
E1
\`\`\`

Fix lint.

**typecheck** failed (exit code 2):

\`\`\`
E2
\`\`\`

Fix types.

**check** failed (exit code 3):

\`\`\`
E3
\`\`\`

Fix tests.`;

		expect(countCheckFailures(message)).toBe(3);
	});

	test("renders multiple failures in badge with count", () => {
		const message = `Badger checks failed:

**scripts/lint** failed (exit code 1):

\`\`\`
Lint error
\`\`\`

Fix lint.

**scripts/check** failed (exit code 2):

\`\`\`
Test error
\`\`\`

Fix tests.`;

		const label = extractCheckLabel(message);
		const count = countCheckFailures(message);

		expect(label).toBe("scripts/lint");
		expect(count).toBe(2);
		// Renderer shows: "☠ 2 checks failed" when count > 1
	});
});