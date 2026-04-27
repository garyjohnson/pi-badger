import { describe, test, expect } from "bun:test";
import { stripAnsi, TailOverlay } from "../extensions/badger/tail-overlay.js";
import { visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";

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

	test("strips carriage returns (\\x0d)", () => {
		expect(stripAnsi("line1\rline2")).toBe("line1line2");
		expect(stripAnsi("hello\r\nworld")).toBe("hello\nworld");
	});

	test("strips null bytes (\\x00)", () => {
		expect(stripAnsi("abc\x00def")).toBe("abcdef");
	});

	test("strips backspace characters (\\x08)", () => {
		expect(stripAnsi("foo\x08bar")).toBe("foobar");
	});

	test("strips vertical tab (\\x0b) and form feed (\\x0c)", () => {
		expect(stripAnsi("a\x0bb")).toBe("ab");
		expect(stripAnsi("a\x0cb")).toBe("ab");
	});

	test("strips C1-adjacent C0 controls (\\x0e through \\x1f)", () => {
		expect(stripAnsi("a\x0eb")).toBe("ab"); // SO
		expect(stripAnsi("a\x0fb")).toBe("ab"); // SI
		expect(stripAnsi("a\x1ab")).toBe("ab"); // SUB
		expect(stripAnsi("a\x1cb")).toBe("ab"); // FS
		expect(stripAnsi("a\x1db")).toBe("ab"); // GS
		expect(stripAnsi("a\x1eb")).toBe("ab"); // RS
		expect(stripAnsi("a\x1fb")).toBe("ab"); // US
	});

	test("strips standalone ESC (\\x1b) not part of ANSI sequence", () => {
		expect(stripAnsi("a\x1bb")).toBe("ab");
	});

	test("strips DEL (\\x7f)", () => {
		expect(stripAnsi("a\x7fb")).toBe("ab");
	});

	test("preserves newlines (\\x0a)", () => {
		expect(stripAnsi("line1\nline2")).toBe("line1\nline2");
	});

	test("preserves tabs (\\x09) for separate expansion", () => {
		// Tabs are kept so callers can expand them to spaces
		expect(stripAnsi("a\tb")).toBe("a\tb");
	});

	test("strips mixed control characters and ANSI", () => {
		expect(stripAnsi("\x1b[31m\x00red\x1b[0m\rtext\x7f")).toBe("redtext");
	});
});

describe("TailOverlay.addOutput", () => {
	/** Minimal theme mock — returns text unchanged (no coloring). */
	const mockTheme = { fg: (_color: string, text: string) => text } as any;

	function createOverlay(maxLines = 5): TailOverlay {
		return new TailOverlay("test", maxLines, mockTheme, () => {});
	}

	test("expands tabs to 4 spaces", () => {
		const overlay = createOverlay();
		overlay.addOutput("a\tb");
		const lines = overlay.render(80);
		const contentLines = lines.filter((l) => l.includes("a    b"));
		expect(contentLines.length).toBeGreaterThan(0);
	});

	test("strips ANSI codes from output", () => {
		const overlay = createOverlay();
		overlay.addOutput("\x1b[31mError\x1b[0m");
		const lines = overlay.render(80);
		const contentLines = lines.filter((l) => l.includes("Error") && !l.includes("\x1b["));
		expect(contentLines.length).toBeGreaterThan(0);
	});

	test("strips carriage returns from output", () => {
		const overlay = createOverlay();
		overlay.addOutput("hello\r\nworld");
		const lines = overlay.render(80);
		const contentLines = lines.filter((l) => l.includes("hello") && !l.includes("\r"));
		expect(contentLines.length).toBeGreaterThan(0);
	});

	test("strips null bytes from output", () => {
		const overlay = createOverlay();
		overlay.addOutput("a\x00b");
		const lines = overlay.render(80);
		const contentLines = lines.filter((l) => l.includes("ab") && !l.includes("\x00"));
		expect(contentLines.length).toBeGreaterThan(0);
	});

	test("strips DEL from output", () => {
		const overlay = createOverlay();
		overlay.addOutput("a\x7fb");
		const lines = overlay.render(80);
		const contentLines = lines.filter((l) => l.includes("ab") && !l.includes("\x7f"));
		expect(contentLines.length).toBeGreaterThan(0);
	});

	test("expands multiple tabs", () => {
		const overlay = createOverlay();
		overlay.addOutput("\tcol1\tcol2\t");
		const lines = overlay.render(80);
		const contentLines = lines.filter((l) => l.includes("    col1    col2    "));
		expect(contentLines.length).toBeGreaterThan(0);
	});

	test("handles empty output", () => {
		const overlay = createOverlay();
		overlay.addOutput("");
		const lines = overlay.render(80);
		// Should still produce a box (header + content + footer)
		expect(lines.length).toBeGreaterThan(0);
	});

	test("renders tab-expanded lines within terminal width", () => {
		const overlay = createOverlay(5);
		// These lines caused the original crash — tabs in make/busted output
		overlay.addOutput("Success:\t3\t");
		overlay.addOutput("Failed:\t0\t");
		overlay.addOutput("Errors:\t0\t");
		overlay.addOutput("========================================");
		const terminalWidth = 80;
		const lines = overlay.render(terminalWidth);
		// Every rendered line must have visible width <= terminal width
		for (const line of lines) {
			const w = visibleWidth(line);
			expect(w).toBeLessThanOrEqual(terminalWidth);
		}
	});

	test("renders long lines with truncation within terminal width", () => {
		const overlay = createOverlay(3);
		overlay.addOutput("a".repeat(200));
		const terminalWidth = 60;
		const lines = overlay.render(terminalWidth);
		for (const line of lines) {
			const w = visibleWidth(line);
			expect(w).toBeLessThanOrEqual(terminalWidth);
		}
	});
});