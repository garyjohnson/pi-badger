import { describe, test, expect } from "bun:test";
import { buildCommand, entryLabel } from "../extensions/badger/runner.js";
import type { CheckEntry } from "../extensions/badger/types.js";

describe("buildCommand", () => {
	test("replaces $CHANGED_FILES with quoted file paths", () => {
		const result = buildCommand("npx eslint $CHANGED_FILES", ["src/a.ts", "src/b.ts"]);
		expect(result).toBe("npx eslint 'src/a.ts' 'src/b.ts'");
	});

	test("omits changed files when no $CHANGED_FILES placeholder", () => {
		const result = buildCommand("npx vitest run", ["src/a.test.ts"]);
		expect(result).toBe("npx vitest run");
	});

	test("handles single quotes in file paths", () => {
		const result = buildCommand("lint $CHANGED_FILES", ["it's/bad.ts"]);
		expect(result).toBe("lint 'it'\\''s/bad.ts'");
	});

	test("handles empty files list", () => {
		const result = buildCommand("npx eslint $CHANGED_FILES", []);
		expect(result).toBe("npx eslint ");
	});

	test("replaces multiple $CHANGED_FILES occurrences", () => {
		const result = buildCommand("echo $CHANGED_FILES | lint $CHANGED_FILES", ["a.ts"]);
		expect(result).toBe("echo 'a.ts' | lint 'a.ts'");
	});
});

describe("entryLabel", () => {
	test("returns command for command entries", () => {
		const entry: CheckEntry = { type: "command", command: "npx eslint" };
		expect(entryLabel(entry)).toBe("npx eslint");
	});

	test("returns path for script entries", () => {
		const entry: CheckEntry = { type: "script", path: "scripts/lint" };
		expect(entryLabel(entry)).toBe("scripts/lint");
	});

	test("returns label for prompt entries", () => {
		const entry: CheckEntry = { type: "prompt", content: "Check everything" };
		expect(entryLabel(entry)).toBe("(prompt)");
	});
});