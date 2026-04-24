/**
 * Badger — File watching, hashing, and change detection
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import picomatch from "picomatch";
import type { FileHash, Change } from "./types.js";

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

/** Check if a file path matches include patterns and not exclude patterns */
export function matchesPatterns(
	filePath: string,
	includePatterns: string[],
	excludePatterns: string[],
): boolean {
	const isMatch = picomatch(includePatterns, { dot: true });
	const isExcluded = excludePatterns.length > 0
		? picomatch(excludePatterns, { dot: true })
		: () => false;

	// Normalize to forward slashes
	const normalized = filePath.replace(/\\/g, "/");
	return isMatch(normalized) && !isExcluded(normalized);
}

/** Check if a directory path should be pruned (not descended into) based on exclude patterns */
export function shouldPruneDirectory(
	dirName: string,
	dirPath: string,
	excludePatterns: string[],
): boolean {
	if (excludePatterns.length === 0) return false;

	const isExcluded = picomatch(excludePatterns, { dot: true });
	const normalized = dirPath.replace(/\\/g, "/");

	// Test both the directory name alone (covers "node_modules" matching anywhere)
	// and the full relative path (covers "**/dist/subdir" and similar)
	if (isExcluded(dirName)) return true;
	if (isExcluded(normalized)) return true;
	if (isExcluded(normalized + "/")) return true;

	return false;
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/** Recursively discover files matching watch patterns */
export function discoverWatchedFiles(
	cwd: string,
	includePatterns: string[],
	excludePatterns: string[],
): string[] {
	const results: string[] = [];

	function walkDir(dir: string): void {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (entry.isDirectory()) {
				const dirPath = path.relative(cwd, path.join(dir, entry.name)).replace(/\\/g, "/");
				if (shouldPruneDirectory(entry.name, dirPath, excludePatterns)) continue;
				walkDir(path.join(dir, entry.name));
			} else if (entry.isFile()) {
				const filePath = path.relative(cwd, path.join(dir, entry.name)).replace(/\\/g, "/");
				if (matchesPatterns(filePath, includePatterns, excludePatterns)) {
					results.push(filePath);
				}
			}
		}
	}

	walkDir(cwd);
	return results.sort();
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** Compute a hash of a file's contents */
export function hashFile(cwd: string, filePath: string): string {
	const fullPath = path.join(cwd, filePath);
	try {
		const content = fs.readFileSync(fullPath);
		return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
	} catch {
		return "";
	}
}

/** Get mtime of a file */
export function getFileMtime(cwd: string, filePath: string): number {
	const fullPath = path.join(cwd, filePath);
	try {
		const stat = fs.statSync(fullPath);
		return stat.mtimeMs;
	} catch {
		return 0;
	}
}

/** Build a hash map of watched files */
export function buildHashMap(
	cwd: string,
	includePatterns: string[],
	excludePatterns: string[],
): Map<string, FileHash> {
	const files = discoverWatchedFiles(cwd, includePatterns, excludePatterns);
	const map = new Map<string, FileHash>();
	for (const filePath of files) {
		map.set(filePath, {
			hash: hashFile(cwd, filePath),
			mtime: getFileMtime(cwd, filePath),
		});
	}
	return map;
}

/** Rebuild hash map efficiently: only re-hash files whose mtime changed, discover new/deleted files */
export function rebuildHashMap(
	cwd: string,
	includePatterns: string[],
	excludePatterns: string[],
	oldMap: Map<string, FileHash>,
	options?: { debugLog?: (category: string, message: string, details?: Record<string, unknown>) => void },
): Map<string, FileHash> {
	const currentFiles = new Set(
		discoverWatchedFiles(cwd, includePatterns, excludePatterns),
	);

	const newMap = new Map<string, FileHash>();
	const reused: string[] = [];
	const rehashed: Array<{ file: string; reason: string; oldHash?: string; newHash: string; mtimeChanged: boolean; hashChanged: boolean }> = [];
	const added: string[] = [];

	for (const filePath of currentFiles) {
		const oldEntry = oldMap.get(filePath);
		const currentMtime = getFileMtime(cwd, filePath);

		if (oldEntry && oldEntry.mtime === currentMtime) {
			// File unchanged since last check — reuse hash
			newMap.set(filePath, oldEntry);
			reused.push(filePath);
		} else {
			// New file or modified — compute fresh hash
			const newHash = hashFile(cwd, filePath);
			newMap.set(filePath, {
				hash: newHash,
				mtime: currentMtime,
			});

			if (!oldEntry) {
				added.push(filePath);
			} else {
				const hashChanged = oldEntry.hash !== newHash;
				rehashed.push({
					file: filePath,
					reason: hashChanged ? "content changed" : "mtime changed but content same",
					oldHash: oldEntry.hash,
					newHash,
					mtimeChanged: true,
					hashChanged,
				});
			}
		}
	}

	const deleted = [...oldMap.keys()].filter(f => !currentFiles.has(f));

	if (options?.debugLog) {
		options.debugLog("rebuildHashMap", "Rebuild summary", {
			totalFiles: currentFiles.size,
			reusedCount: reused.length,
			rehashedCount: rehashed.length,
			addedCount: added.length,
			deletedCount: deleted.length,
			rehashedDetails: rehashed.length > 0 ? rehashed : undefined,
			addedFiles: added.length > 0 ? added : undefined,
			deletedFiles: deleted.length > 0 ? deleted : undefined,
		});
	}

	return newMap;
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

/** Diff two hash maps, returning files where hashes differ or files were added/removed */
export function diffHashMaps(
	oldMap: Map<string, FileHash>,
	newMap: Map<string, FileHash>,
): Change[] {
	const changes: Change[] = [];

	// New or modified files
	for (const [filePath, info] of newMap) {
		const oldInfo = oldMap.get(filePath);
		if (!oldInfo) {
			changes.push({ filePath, changeType: "added", newHash: info.hash });
		} else if (oldInfo.hash !== info.hash) {
			changes.push({ filePath, changeType: "modified", oldHash: oldInfo.hash, newHash: info.hash });
		}
	}

	// Deleted files
	for (const filePath of oldMap.keys()) {
		if (!newMap.has(filePath)) {
			const oldInfo = oldMap.get(filePath)!;
			changes.push({ filePath, changeType: "deleted", oldHash: oldInfo.hash });
		}
	}

	return changes;
}

/** Get just file paths from diff results */
export function diffFilePaths(changes: Change[]): string[] {
	return changes.map(c => c.filePath);
}

// ---------------------------------------------------------------------------
// Debug helpers
// ---------------------------------------------------------------------------

/** Summarize a hash map for debug logging — shows size and per-file hash/mtime */
export function summarizeHashMap(
	label: string,
	map: Map<string, FileHash>,
): { label: string; fileCount: number; entries: Record<string, { hash: string; mtime: number }> } {
	const entries: Record<string, { hash: string; mtime: number }> = {};
	for (const [filePath, info] of map) {
		entries[filePath] = { hash: info.hash, mtime: info.mtime };
	}
	return { label, fileCount: map.size, entries };
}