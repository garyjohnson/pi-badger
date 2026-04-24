import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	matchesPatterns,
	discoverWatchedFiles,
	hashFile,
	buildHashMap,
	rebuildHashMap,
	diffHashMaps,
	diffFilePaths,
	summarizeHashMap,
} from "../extensions/badger/file-watcher.js";
import { createTempDir, createFile } from "./helpers.js";

describe("matchesPatterns", () => {
	const includes = ["src/**/*", "test/**/*"];
	const excludes = ["**/*.lock", "dist/**/*"];

	test("matches file in include patterns", () => {
		expect(matchesPatterns("src/index.ts", includes, excludes)).toBe(true);
	});

	test("matches file in test patterns", () => {
		expect(matchesPatterns("test/foo.test.ts", includes, excludes)).toBe(true);
	});

	test("rejects file not in any include pattern", () => {
		expect(matchesPatterns("docs/readme.md", includes, excludes)).toBe(false);
	});

	test("rejects file matching exclude pattern", () => {
		expect(matchesPatterns("src/package.lock", includes, excludes)).toBe(false);
	});

	test("rejects file in excluded directory", () => {
		expect(matchesPatterns("dist/index.js", includes, excludes)).toBe(false);
	});

	test("normalizes backslashes", () => {
		expect(matchesPatterns("src\\index.ts", includes, [])).toBe(true);
	});

	test("empty exclude patterns match everything in includes", () => {
		expect(matchesPatterns("src/anything.ts", includes, [])).toBe(true);
	});
});

describe("discoverWatchedFiles", () => {
	let tmp: { dir: string; cleanup: () => void };

	beforeEach(() => {
		tmp = createTempDir();
	});

	afterEach(() => {
		tmp.cleanup();
	});

	test("discovers files matching include patterns", () => {
		createFile(tmp.dir, "src/index.ts", "content");
		createFile(tmp.dir, "src/utils.ts", "content");
		createFile(tmp.dir, "test/index.test.ts", "content");

		const files = discoverWatchedFiles(tmp.dir, ["src/**/*", "test/**/*"], []);
		expect(files).toContain("src/index.ts");
		expect(files).toContain("src/utils.ts");
		expect(files).toContain("test/index.test.ts");
	});

	test("excludes files matching exclude patterns", () => {
		createFile(tmp.dir, "src/index.ts", "content");
		createFile(tmp.dir, "src/package.lock", "lock content");

		const files = discoverWatchedFiles(tmp.dir, ["src/**/*"], ["**/*.lock"]);
		expect(files).toContain("src/index.ts");
		expect(files).not.toContain("src/package.lock");
	});

	test("skips known directories like node_modules and .git", () => {
		createFile(tmp.dir, "src/index.ts", "content");
		createFile(tmp.dir, "node_modules/foo/index.js", "dep");
		createFile(tmp.dir, ".git/HEAD", "git data");

		const files = discoverWatchedFiles(tmp.dir, ["**/*"], []);
		expect(files).toContain("src/index.ts");
		expect(files).not.toContain("node_modules/foo/index.js");
		expect(files).not.toContain(".git/HEAD");
	});

	test("returns sorted results", () => {
		createFile(tmp.dir, "src/z.ts", "z");
		createFile(tmp.dir, "src/a.ts", "a");

		const files = discoverWatchedFiles(tmp.dir, ["src/**/*"], []);
		expect(files).toEqual(["src/a.ts", "src/z.ts"]);
	});

	test("returns empty array when no files match", () => {
		createFile(tmp.dir, "docs/readme.md", "readme");
		const files = discoverWatchedFiles(tmp.dir, ["src/**/*"], []);
		expect(files).toEqual([]);
	});
});

describe("hashFile", () => {
	let tmp: { dir: string; cleanup: () => void };

	beforeEach(() => {
		tmp = createTempDir();
	});

	afterEach(() => {
		tmp.cleanup();
	});

	test("returns consistent hash for same content", () => {
		createFile(tmp.dir, "src/a.ts", "hello world");
		const hash1 = hashFile(tmp.dir, "src/a.ts");
		const hash2 = hashFile(tmp.dir, "src/a.ts");
		expect(hash1).toBe(hash2);
	});

	test("returns different hash for different content", () => {
		createFile(tmp.dir, "src/a.ts", "hello");
		createFile(tmp.dir, "src/b.ts", "world");
		const hashA = hashFile(tmp.dir, "src/a.ts");
		const hashB = hashFile(tmp.dir, "src/b.ts");
		expect(hashA).not.toBe(hashB);
	});

	test("returns empty string for non-existent file", () => {
		const hash = hashFile(tmp.dir, "nonexistent.ts");
		expect(hash).toBe("");
	});
});

describe("buildHashMap", () => {
	let tmp: { dir: string; cleanup: () => void };

	beforeEach(() => {
		tmp = createTempDir();
	});

	afterEach(() => {
		tmp.cleanup();
	});

	test("builds hash map for matching files", () => {
		createFile(tmp.dir, "src/index.ts", "content A");
		createFile(tmp.dir, "src/utils.ts", "content B");

		const hashMap = buildHashMap(tmp.dir, ["src/**/*"], []);
		expect(hashMap.size).toBe(2);
		expect(hashMap.has("src/index.ts")).toBe(true);
		expect(hashMap.has("src/utils.ts")).toBe(true);
	});

	test("each entry has hash and mtime", () => {
		createFile(tmp.dir, "src/index.ts", "hello");

		const hashMap = buildHashMap(tmp.dir, ["src/**/*"], []);
		const entry = hashMap.get("src/index.ts")!;
		expect(entry.hash).toBeTruthy();
		expect(entry.mtime).toBeGreaterThan(0);
	});
});

describe("diffHashMaps", () => {
	test("detects added files", () => {
		const oldMap = new Map();
		const newMap = new Map([["src/new.ts", { hash: "abc", mtime: 1000 }]]);

		const changes = diffHashMaps(oldMap, newMap);
		expect(changes).toHaveLength(1);
		expect(changes[0].changeType).toBe("added");
		expect(changes[0].filePath).toBe("src/new.ts");
		expect(changes[0].newHash).toBe("abc");
	});

	test("detects modified files", () => {
		const oldMap = new Map([["src/index.ts", { hash: "abc", mtime: 1000 }]]);
		const newMap = new Map([["src/index.ts", { hash: "xyz", mtime: 1001 }]]);

		const changes = diffHashMaps(oldMap, newMap);
		expect(changes).toHaveLength(1);
		expect(changes[0].changeType).toBe("modified");
		expect(changes[0].filePath).toBe("src/index.ts");
		expect(changes[0].oldHash).toBe("abc");
		expect(changes[0].newHash).toBe("xyz");
	});

	test("detects deleted files", () => {
		const oldMap = new Map([["src/deleted.ts", { hash: "abc", mtime: 1000 }]]);
		const newMap = new Map();

		const changes = diffHashMaps(oldMap, newMap);
		expect(changes).toHaveLength(1);
		expect(changes[0].changeType).toBe("deleted");
		expect(changes[0].filePath).toBe("src/deleted.ts");
		expect(changes[0].oldHash).toBe("abc");
	});

	test("returns empty array when maps are identical", () => {
		const map = new Map([["src/index.ts", { hash: "abc", mtime: 1000 }]]);
		const changes = diffHashMaps(map, map);
		expect(changes).toHaveLength(0);
	});

	test("detects multiple change types simultaneously", () => {
		const oldMap = new Map([
			["src/kept.ts", { hash: "aaa", mtime: 1000 }],
			["src/modified.ts", { hash: "bbb", mtime: 1000 }],
			["src/deleted.ts", { hash: "ccc", mtime: 1000 }],
		]);
		const newMap = new Map([
			["src/kept.ts", { hash: "aaa", mtime: 1000 }],
			["src/modified.ts", { hash: "ddd", mtime: 1001 }],
			["src/added.ts", { hash: "eee", mtime: 1002 }],
		]);

		const changes = diffHashMaps(oldMap, newMap);
		expect(changes).toHaveLength(3);

		const byType = Object.fromEntries(changes.map(c => [c.changeType, c]));
		expect(byType["added"].filePath).toBe("src/added.ts");
		expect(byType["modified"].filePath).toBe("src/modified.ts");
		expect(byType["deleted"].filePath).toBe("src/deleted.ts");
	});
});

describe("diffFilePaths", () => {
	test("extracts just file paths from changes", () => {
		const changes = [
			{ filePath: "src/a.ts", changeType: "added" as const, newHash: "abc" },
			{ filePath: "src/b.ts", changeType: "modified" as const, oldHash: "def", newHash: "ghi" },
			{ filePath: "src/c.ts", changeType: "deleted" as const, oldHash: "jkl" },
		];
		expect(diffFilePaths(changes)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
	});
});

describe("rebuildHashMap", () => {
	let tmp: { dir: string; cleanup: () => void };

	beforeEach(() => {
		tmp = createTempDir();
	});

	afterEach(() => {
		tmp.cleanup();
	});

	test("reuses hashes for unchanged files (same mtime)", () => {
		createFile(tmp.dir, "src/index.ts", "stable content");
		const oldMap = buildHashMap(tmp.dir, ["src/**/*"], []);

		// Rebuild without modifying the file — mtime should be the same
		const newMap = rebuildHashMap(tmp.dir, ["src/**/*"], [], oldMap);
		const oldEntry = oldMap.get("src/index.ts")!;
		const newEntry = newMap.get("src/index.ts")!;
		expect(newEntry.hash).toBe(oldEntry.hash);
		expect(newEntry.mtime).toBe(oldEntry.mtime);
	});

	test("re-hashes files with changed mtime", () => {
		createFile(tmp.dir, "src/index.ts", "initial");

		// Build the "old" map, then simulate a prior mtime by constructing manually
		const currentMap = buildHashMap(tmp.dir, ["src/**/*"], []);
		const currentEntry = currentMap.get("src/index.ts")!;
		const oldMap = new Map([
			["src/index.ts", { hash: "stalehash", mtime: currentEntry.mtime - 1000 }],
		]);

		// Rebuild should detect the mtime difference and re-hash
		const newMap = rebuildHashMap(tmp.dir, ["src/**/*"], [], oldMap);
		const newEntry = newMap.get("src/index.ts")!;
		expect(newEntry.mtime).not.toBe(oldMap.get("src/index.ts")!.mtime);
		expect(newEntry.hash).not.toBe("stalehash");
		expect(newEntry.hash).toBe(currentEntry.hash); // re-hashed to correct value
	});

	test("discovers newly added files", () => {
		createFile(tmp.dir, "src/index.ts", "initial");
		const oldMap = buildHashMap(tmp.dir, ["src/**/*"], []);

		// Add a new file
		createFile(tmp.dir, "src/new.ts", "new file");

		const newMap = rebuildHashMap(tmp.dir, ["src/**/*"], [], oldMap);
		expect(newMap.has("src/new.ts")).toBe(true);
		expect(newMap.size).toBe(oldMap.size + 1);
	});

	test("removes deleted files", () => {
		createFile(tmp.dir, "src/index.ts", "content");
		createFile(tmp.dir, "src/to-delete.ts", "will be deleted");
		const oldMap = buildHashMap(tmp.dir, ["src/**/*"], []);

		// Delete a file
		fs.unlinkSync(path.join(tmp.dir, "src/to-delete.ts"));

		const newMap = rebuildHashMap(tmp.dir, ["src/**/*"], [], oldMap);
		expect(newMap.has("src/to-delete.ts")).toBe(false);
		expect(newMap.size).toBe(oldMap.size - 1);
	});

	test("calls debugLog when provided", () => {
		createFile(tmp.dir, "src/index.ts", "initial");
		const oldMap = buildHashMap(tmp.dir, ["src/**/*"], []);

		const logEntries: Array<{ category: string; message: string; details?: Record<string, unknown> }> = [];
		const mockDebugLog = (category: string, message: string, details?: Record<string, unknown>) => {
			logEntries.push({ category, message, details });
		};

		rebuildHashMap(tmp.dir, ["src/**/*"], [], oldMap, { debugLog: mockDebugLog });

		expect(logEntries.length).toBe(1);
		expect(logEntries[0].category).toBe("rebuildHashMap");
		expect(logEntries[0].message).toBe("Rebuild summary");
		expect(logEntries[0].details).toBeDefined();
		expect(logEntries[0].details!.reusedCount).toBe(1);
		expect(logEntries[0].details!.rehashedCount).toBe(0);
	});

	test("debugLog shows rehashed details when mtime changes", () => {
		createFile(tmp.dir, "src/index.ts", "initial");
		const currentMap = buildHashMap(tmp.dir, ["src/**/*"], []);
		const currentEntry = currentMap.get("src/index.ts")!;

		// Simulate stale mtime
		const staleMap = new Map([
			["src/index.ts", { hash: "stalehash", mtime: currentEntry.mtime - 1000 }],
		]);

		const logEntries: Array<{ category: string; message: string; details?: Record<string, unknown> }> = [];
		const mockDebugLog = (category: string, message: string, details?: Record<string, unknown>) => {
			logEntries.push({ category, message, details });
		};

		rebuildHashMap(tmp.dir, ["src/**/*"], [], staleMap, { debugLog: mockDebugLog });

		expect(logEntries.length).toBe(1);
		const details = logEntries[0].details!;
		expect(details.reusedCount).toBe(0);
		expect(details.rehashedCount).toBe(1);
		expect((details.rehashedDetails as Array<unknown>).length).toBe(1);
	});

	test("works without debugLog option (default)", () => {
		createFile(tmp.dir, "src/index.ts", "content");
		const oldMap = buildHashMap(tmp.dir, ["src/**/*"], []);

		// Should not throw
		const newMap = rebuildHashMap(tmp.dir, ["src/**/*"], [], oldMap);
		expect(newMap.size).toBe(1);
	});
});

describe("summarizeHashMap", () => {
	test("summarizes a hash map with entries", () => {
		const map = new Map([
			["src/a.ts", { hash: "abc123", mtime: 1000 }],
			["src/b.ts", { hash: "def456", mtime: 2000 }],
		]);

		const summary = summarizeHashMap("test", map);
		expect(summary.label).toBe("test");
		expect(summary.fileCount).toBe(2);
		expect(summary.entries["src/a.ts"]).toEqual({ hash: "abc123", mtime: 1000 });
		expect(summary.entries["src/b.ts"]).toEqual({ hash: "def456", mtime: 2000 });
	});

	test("summarizes an empty hash map", () => {
		const map = new Map();
		const summary = summarizeHashMap("empty", map);
		expect(summary.label).toBe("empty");
		expect(summary.fileCount).toBe(0);
		expect(Object.keys(summary.entries)).toHaveLength(0);
	});
});