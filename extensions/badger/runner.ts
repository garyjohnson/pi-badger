/**
 * Badger — Unified check/release entry runner
 *
 * Handles executing scripts and commands, substituting $CHANGED_FILES,
 * supporting abort signals, and returning structured results.
 */

import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CheckEntry, RunResult } from "./types.js";

// ---------------------------------------------------------------------------
// Entry execution
// ---------------------------------------------------------------------------

/** Run a script and return exit code and output. */
async function runScript(
	pi: ExtensionAPI,
	cwd: string,
	scriptPath: string,
	args: string[] = [],
	signal?: AbortSignal,
): Promise<RunResult> {
	const fullPath = path.resolve(cwd, scriptPath);
	try {
		const result = await pi.exec(fullPath, args, { cwd, signal });
		return {
			exitCode: result.code ?? 1,
			stdout: result.stdout,
			stderr: result.stderr,
			aborted: false,
		};
	} catch (err) {
		if (signal?.aborted) {
			return { exitCode: -1, stdout: "", stderr: "Aborted", aborted: true };
		}
		return {
			exitCode: 1,
			stdout: "",
			stderr: err instanceof Error ? err.message : String(err),
			aborted: false,
		};
	}
}

/** Run a shell command and return exit code and output. */
async function runCommand(
	pi: ExtensionAPI,
	cwd: string,
	commandStr: string,
	signal?: AbortSignal,
): Promise<RunResult> {
	try {
		const result = await pi.exec("sh", ["-c", commandStr], { cwd, signal });
		return {
			exitCode: result.code ?? 1,
			stdout: result.stdout,
			stderr: result.stderr,
			aborted: false,
		};
	} catch (err) {
		if (signal?.aborted) {
			return { exitCode: -1, stdout: "", stderr: "Aborted", aborted: true };
		}
		return {
			exitCode: 1,
			stdout: "",
			stderr: err instanceof Error ? err.message : String(err),
			aborted: false,
		};
	}
}

/** Build a shell command string, replacing $CHANGED_FILES with quoted file paths. */
export function buildCommand(commandTemplate: string, files: string[]): string {
	const quotedFiles = files.map((f) => `'${f.replace(/'/g, "'\\''")}'`);
	if (commandTemplate.includes("$CHANGED_FILES")) {
		return commandTemplate.replace(/\$CHANGED_FILES/g, quotedFiles.join(" "));
	}
	// No placeholder — commands must opt in to receiving changed files via $CHANGED_FILES
	return commandTemplate;
}

/** Get a human-readable label for an entry */
export function entryLabel(entry: CheckEntry): string {
	if (entry.type === "command") return entry.command ?? "(command)";
	if (entry.type === "script") return entry.path ?? "(script)";
	return "(prompt)";
}

/**
 * Run a single check/release entry.
 *
 * Determines entry type, routes to script or command runner,
 * substitutes $CHANGED_FILES for command entries if changed files are provided.
 *
 * Returns the RunResult plus metadata for logging.
 */
export async function runEntry(
	entry: CheckEntry,
	cwd: string,
	pi: ExtensionAPI,
	options?: { signal?: AbortSignal; changedFiles?: string[] },
): Promise<RunResult> {
	const { signal, changedFiles } = options ?? {};
	const startTime = Date.now();

	let result: RunResult;

	if (entry.type === "command" && entry.command) {
		const cmd = changedFiles && changedFiles.length > 0
			? buildCommand(entry.command, changedFiles)
			: entry.command;
		result = await runCommand(pi, cwd, cmd, signal);
	} else if (entry.type === "script" && entry.path) {
		result = await runScript(pi, cwd, entry.path!, changedFiles ?? [], signal);
	} else if (entry.type === "prompt") {
		// Prompt entries don't execute anything — they're handled by the caller
		result = { exitCode: 0, stdout: "", stderr: "", aborted: false };
	} else {
		result = {
			exitCode: 1,
			stdout: "",
			stderr: `Invalid entry: type=${entry.type}, path=${entry.path}, command=${entry.command}`,
			aborted: false,
		};
	}

	result.elapsed = Date.now() - startTime;
	return result;
}

// Re-export the internal runners for direct testing
export { runScript, runCommand };