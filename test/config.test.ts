import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, DEFAULT_CONFIG } from "../extensions/badger/config.js";
import { createTempDir, writeBadgerConfig } from "./helpers.js";

describe("loadConfig", () => {
	let tmp: { dir: string; cleanup: () => void };

	beforeEach(() => {
		tmp = createTempDir();
	});

	afterEach(() => {
		tmp.cleanup();
	});

	test("returns null when no config file exists", () => {
		const result = loadConfig(tmp.dir);
		expect(result).toBeNull();
	});

	test("returns defaults when config is empty object", () => {
		writeBadgerConfig(tmp.dir, {});
		const result = loadConfig(tmp.dir);
		expect(result).not.toBeNull();
		expect(result!.watchPatterns).toEqual(DEFAULT_CONFIG.watchPatterns);
		expect(result!.excludePatterns).toEqual(DEFAULT_CONFIG.excludePatterns);
		expect(result!.notifyWithoutConfig).toBe(DEFAULT_CONFIG.notifyWithoutConfig);
		expect(result!.debug).toBe(DEFAULT_CONFIG.debug);
		expect(result!.checksFast).toEqual(DEFAULT_CONFIG.checksFast);
		expect(result!.checks).toEqual(DEFAULT_CONFIG.checks);
		expect(result!.release).toEqual(DEFAULT_CONFIG.release);
	});

	test("merges partial user config with defaults", () => {
		writeBadgerConfig(tmp.dir, {
			watchPatterns: ["src/**/*.ts"],
			debug: true,
		});
		const result = loadConfig(tmp.dir);
		expect(result).not.toBeNull();
		expect(result!.watchPatterns).toEqual(["src/**/*.ts"]);
		expect(result!.debug).toBe(true);
		// Defaults are preserved for unprovided fields
		expect(result!.excludePatterns).toEqual([]);
		expect(result!.checksFast).toEqual(DEFAULT_CONFIG.checksFast);
		expect(result!.checks).toEqual(DEFAULT_CONFIG.checks);
		expect(result!.release).toEqual(DEFAULT_CONFIG.release);
	});

	test("handles release: null as explicitly disabled", () => {
		writeBadgerConfig(tmp.dir, { release: null });
		const result = loadConfig(tmp.dir);
		expect(result).not.toBeNull();
		expect(result!.release).toBeNull();
	});

	test("handles release: undefined by using default", () => {
		writeBadgerConfig(tmp.dir, {});
		const result = loadConfig(tmp.dir);
		expect(result).not.toBeNull();
		expect(result!.release).toEqual(DEFAULT_CONFIG.release);
	});

	test("returns null for malformed JSON", () => {
		const piDir = path.join(tmp.dir, ".pi");
		fs.mkdirSync(piDir, { recursive: true });
		fs.writeFileSync(path.join(piDir, "badger.json"), "{invalid json!!!");
		const result = loadConfig(tmp.dir);
		expect(result).toBeNull();
	});

	test("returns null for unreadable config", () => {
		// Non-existent directory
		const result = loadConfig("/nonexistent/path/that/does/not/exist");
		expect(result).toBeNull();
	});

	test("preserves full user config for checksFast and checks", () => {
		const customChecksFast = [
			{
				type: "command" as const,
				command: "npx eslint $CHANGED_FILES",
				fileFilter: ["*.ts"],
				failurePrompt: "Fix lint errors",
			},
		];
		const customChecks = [
			{
				type: "command" as const,
				command: "npx vitest run",
				failurePrompt: "Fix test failures",
			},
		];
		writeBadgerConfig(tmp.dir, {
			checksFast: customChecksFast,
			checks: customChecks,
		});
		const result = loadConfig(tmp.dir);
		expect(result).not.toBeNull();
		expect(result!.checksFast).toEqual(customChecksFast);
		expect(result!.checks).toEqual(customChecks);
	});
});