import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, saveConfig, findConfigDir, DEFAULT_CONFIG } from "../extensions/badger/config.js";
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
		expect(result!.debug).toBe(DEFAULT_CONFIG.debug);
		expect(result!.fastFail).toBe(DEFAULT_CONFIG.fastFail);
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
		expect(result!.excludePatterns).toEqual(DEFAULT_CONFIG.excludePatterns);
		expect(result!.fastFail).toBe(DEFAULT_CONFIG.fastFail);
		expect(result!.checksFast).toEqual(DEFAULT_CONFIG.checksFast);
		expect(result!.checks).toEqual(DEFAULT_CONFIG.checks);
		expect(result!.release).toEqual(DEFAULT_CONFIG.release);
	});

	test("handles fastFail: false as explicitly disabled", () => {
		writeBadgerConfig(tmp.dir, { fastFail: false });
		const result = loadConfig(tmp.dir);
		expect(result).not.toBeNull();
		expect(result!.fastFail).toBe(false);
	});

	test("defaults fastFail to true", () => {
		writeBadgerConfig(tmp.dir, {});
		const result = loadConfig(tmp.dir);
		expect(result).not.toBeNull();
		expect(result!.fastFail).toBe(true);
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
	test("finds config in parent directory when called from subdirectory", () => {
		writeBadgerConfig(tmp.dir, { debug: true });
		const subDir = path.join(tmp.dir, "src", "components");
		fs.mkdirSync(subDir, { recursive: true });
		const result = loadConfig(subDir);
		expect(result).not.toBeNull();
		expect(result!.debug).toBe(true);
	});
	test("returns null when no config exists in current or parent directories", () => {
		const subDir = path.join(tmp.dir, "src", "components");
		fs.mkdirSync(subDir, { recursive: true });
		const result = loadConfig(subDir);
		expect(result).toBeNull();
	});
});

describe("findConfigDir", () => {
	let tmp: { dir: string; cleanup: () => void };

	beforeEach(() => {
		tmp = createTempDir();
	});

	afterEach(() => {
		tmp.cleanup();
	});

	test("returns cwd when config exists directly", () => {
		writeBadgerConfig(tmp.dir, {});
		const result = findConfigDir(tmp.dir);
		expect(result).toBe(tmp.dir);
	});

	test("returns parent dir when config exists in parent", () => {
		writeBadgerConfig(tmp.dir, {});
		const subDir = path.join(tmp.dir, "subdir");
		fs.mkdirSync(subDir, { recursive: true });
		const result = findConfigDir(subDir);
		expect(result).toBe(tmp.dir);
	});

	test("walks up multiple levels", () => {
		writeBadgerConfig(tmp.dir, {});
		const deepDir = path.join(tmp.dir, "a", "b", "c");
		fs.mkdirSync(deepDir, { recursive: true });
		const result = findConfigDir(deepDir);
		expect(result).toBe(tmp.dir);
	});

	test("returns null when no config exists", () => {
		const result = findConfigDir(tmp.dir);
		expect(result).toBeNull();
	});

	test("returns null for non-existent directory", () => {
		const result = findConfigDir("/nonexistent/path/that/does/not/exist");
		expect(result).toBeNull();
	});
});

describe("saveConfig", () => {
	let tmp: { dir: string; cleanup: () => void };

	beforeEach(() => {
		tmp = createTempDir();
	});

	afterEach(() => {
		tmp.cleanup();
	});

	test("saves config to cwd when no existing config", () => {
		const config = { ...DEFAULT_CONFIG, debug: true };
		saveConfig(tmp.dir, config);
		const configPath = path.join(tmp.dir, ".pi", "badger.json");
		expect(fs.existsSync(configPath)).toBe(true);
		const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		expect(saved.debug).toBe(true);
	});

	test("updates config in parent directory when called from subdirectory", () => {
		writeBadgerConfig(tmp.dir, { debug: false });
		const subDir = path.join(tmp.dir, "src");
		fs.mkdirSync(subDir, { recursive: true });
		const config = { ...DEFAULT_CONFIG, debug: true };
		saveConfig(subDir, config);
		const configPath = path.join(tmp.dir, ".pi", "badger.json");
		const saved = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		expect(saved.debug).toBe(true);
	});
});