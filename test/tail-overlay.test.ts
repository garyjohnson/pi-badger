import { describe, test, expect } from "bun:test";
import { stripAnsi } from "../extensions/badger/tail-overlay.js";

describe("stripAnsi", () => {
	test("strips SGR color codes", () => {
		expect(stripAnsi("\x1b[31mError\x1b[0m")).toBe("Error");
	});

	test("strips bold and color codes", () => {
		expect(stripAnsi("\x1b[1m\x1b[31mError\x1b[0m")).toBe("Error");
	});

	test("leaves plain text unchanged", () => {
		expect(stripAnsi("Hello World")).toBe("Hello World");
	});

	test("strips OSC hyperlink sequences", () => {
		expect(stripAnsi("\x1b]8;;file://test\x1b\\link\x1b]8;;\x1b\\")).toBe("link");
	});

	test("strips mixed ANSI sequences", () => {
		expect(stripAnsi("\x1b[32m✓\x1b[0m Success \x1b[33m⚠\x1b[0m Warning")).toBe("✓ Success ⚠ Warning");
	});

	test("handles empty string", () => {
		expect(stripAnsi("")).toBe("");
	});
});