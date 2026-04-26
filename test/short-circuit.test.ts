import { describe, test, expect } from "bun:test";
import { extractCheckLabel, countCheckFailures } from "../extensions/badger/renderers.js";

/**
 * Tests for short-circuit behavior in full checks (checks).
 * When a check fails, Badger now short-circuits and reports only the first failure.
 * These tests verify the message format produced by short-circuit behavior.
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