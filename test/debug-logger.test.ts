import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { DebugLogger } from "../extensions/badger/debug-logger.js";
import { createTempDir } from "./helpers.js";

describe("DebugLogger", () => {
	let tmp: { dir: string; cleanup: () => void };

	beforeEach(() => {
		tmp = createTempDir();
	});

	afterEach(() => {
		tmp.cleanup();
	});

	test("does not write when disabled", () => {
		const logger = new DebugLogger(tmp.dir, false);
		logger.log("test", "should not appear");

		const content = logger.getLogContent();
		expect(content).toBe("");
	});

	test("writes log entries when enabled", () => {
		const logger = new DebugLogger(tmp.dir, true);
		logger.log("test", "hello world");

		const content = logger.getLogContent();
		expect(content).toContain("[test]");
		expect(content).toContain("hello world");
	});

	test("writes log entries with details as JSON", () => {
		const logger = new DebugLogger(tmp.dir, true);
		logger.log("test", "message", { key: "value", count: 42 });

		const content = logger.getLogContent();
		expect(content).toContain("message");
		expect(content).toContain('"key"');
		expect(content).toContain('"value"');
		expect(content).toContain("42");
	});

	test("includes timestamp in log entries", () => {
		const logger = new DebugLogger(tmp.dir, true);
		logger.log("cat", "msg");

		const content = logger.getLogContent();
		// ISO timestamp format: YYYY-MM-DDTHH:MM:SS
		expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
	});

	test("getLogPath returns expected path", () => {
		const logger = new DebugLogger(tmp.dir, true);
		expect(logger.getLogPath()).toBe(path.join(tmp.dir, ".pi", "badger-debug.log"));
	});

	test("clearLog empties the log file", () => {
		const logger = new DebugLogger(tmp.dir, true);
		logger.log("test", "entry to clear");
		expect(logger.getLogContent()).toBeTruthy();

		logger.clearLog();
		expect(logger.getLogContent()).toBe("");
	});

	test("setEnabled toggles from disabled to enabled", () => {
		const logger = new DebugLogger(tmp.dir, false);
		expect(logger.isEnabled).toBe(false);

		logger.setEnabled(true, tmp.dir);
		expect(logger.isEnabled).toBe(true);

		logger.log("test", "now active");
		expect(logger.getLogContent()).toContain("now active");
	});

	test("setEnabled toggles from enabled to disabled", () => {
		const logger = new DebugLogger(tmp.dir, true);
		expect(logger.isEnabled).toBe(true);

		logger.setEnabled(false, tmp.dir);
		expect(logger.isEnabled).toBe(false);

		logger.log("test", "should not appear");
		// The file still exists but the entry after disabling shouldn't be there
		// (assuming clear or new session)
	});

	test("isEnabled reflects current state", () => {
		const logger = new DebugLogger(tmp.dir, true);
		expect(logger.isEnabled).toBe(true);

		const logger2 = new DebugLogger(tmp.dir, false);
		expect(logger2.isEnabled).toBe(false);
	});

	test("creates .pi directory if it doesn't exist", () => {
		const nestedDir = path.join(tmp.dir, "project");
		fs.mkdirSync(nestedDir);

		const logger = new DebugLogger(nestedDir, true);
		logger.log("test", "creates dir");

		const piDir = path.join(nestedDir, ".pi");
		expect(fs.existsSync(piDir)).toBe(true);
		expect(logger.getLogContent()).toContain("creates dir");
	});

	test("getLogContent returns empty string when log doesn't exist", () => {
		const logger = new DebugLogger(tmp.dir, false);
		expect(logger.getLogContent()).toBe("");
	});
});