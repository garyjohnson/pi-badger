/**
 * Shared test utilities
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

export function createTempDir(prefix = "badger-test-"): { dir: string; cleanup: () => void } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	return {
		dir,
		cleanup: () => {
			fs.rmSync(dir, { recursive: true, force: true });
		},
	};
}

export function writeBadgerConfig(dir: string, config: Record<string, unknown>): void {
	const piDir = path.join(dir, ".pi");
	if (!fs.existsSync(piDir)) {
		fs.mkdirSync(piDir, { recursive: true });
	}
	fs.writeFileSync(path.join(piDir, "badger.json"), JSON.stringify(config, null, 2));
}

export function createFile(dir: string, relativePath: string, content = ""): string {
	const fullPath = path.join(dir, relativePath);
	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, content);
	return relativePath;
}

// ---------------------------------------------------------------------------
// Mock ExtensionAPI
// ---------------------------------------------------------------------------

export interface MockExecResult {
	code: number;
	stdout: string;
	stderr: string;
}

export function createMockPi(overrides?: {
	execResult?: MockExecResult;
}) {
	const defaultResult: MockExecResult = overrides?.execResult ?? {
		code: 0,
		stdout: "",
		stderr: "",
	};

	const calls: {
		method: string;
		args: unknown[];
	}[] = [];

	const exec = (...args: unknown[]) => {
		calls.push({ method: "exec", args });
		return Promise.resolve(defaultResult);
	};

	return {
		exec,
		sendMessage: (...args: unknown[]) => {
			calls.push({ method: "sendMessage", args });
		},
		sendUserMessage: (...args: unknown[]) => {
			calls.push({ method: "sendUserMessage", args });
		},
		on: (...args: unknown[]) => {
			calls.push({ method: "on", args });
		},
		registerCommand: (...args: unknown[]) => {
			calls.push({ method: "registerCommand", args });
		},
		registerMessageRenderer: (...args: unknown[]) => {
			calls.push({ method: "registerMessageRenderer", args });
		},
		calls,
	};
}