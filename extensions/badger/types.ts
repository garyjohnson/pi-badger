/**
 * Badger — Shared type definitions
 */

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface CheckEntry {
	type: "script" | "command" | "prompt";
	path?: string;
	command?: string;
	content?: string;
	fileFilter?: string[];
	failurePrompt?: string;
}

export interface BadgerConfig {
	watchPatterns: string[];
	excludePatterns: string[];
	notifyWithoutConfig: boolean;
	debug: boolean;
	checksFast: CheckEntry[];
	checks: CheckEntry[];
	release?: CheckEntry | null;
}

// ---------------------------------------------------------------------------
// File watching types
// ---------------------------------------------------------------------------

export interface FileHash {
	hash: string;
	mtime: number;
}

export interface Change {
	filePath: string;
	changeType: "added" | "modified" | "deleted";
	oldHash?: string;
	newHash?: string;
}

// ---------------------------------------------------------------------------
// Runner types
// ---------------------------------------------------------------------------

export interface RunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	aborted: boolean;
	elapsed?: number;
}

// ---------------------------------------------------------------------------
// Extension state (shared across event handlers and commands)
// ---------------------------------------------------------------------------

export interface BadgerState {
	config: BadgerConfig | null;
	currentHashMap: Map<string, FileHash>;
	lastRunHashMap: Map<string, FileHash>;
	fastCheckAbortController: AbortController | null;
	isRunningChecks: boolean;
	isRunningRelease: boolean;
}