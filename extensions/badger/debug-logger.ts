/**
 * Badger — Debug logger that writes to a log file
 */

import * as fs from "node:fs";
import * as path from "node:path";

export class DebugLogger {
	private logPath: string;
	private enabled: boolean;

	constructor(cwd: string, enabled: boolean) {
		this.enabled = enabled;
		this.logPath = path.join(cwd, ".pi", "badger-debug.log");
		if (this.enabled) {
			this.ensureDir();
			this.log("session", "Debug logger initialized");
		}
	}

	get isEnabled(): boolean {
		return this.enabled;
	}

	setEnabled(enabled: boolean, cwd: string): void {
		const changed = this.enabled !== enabled;
		this.enabled = enabled;
		if (changed) {
			if (this.enabled) {
				this.logPath = path.join(cwd, ".pi", "badger-debug.log");
				this.ensureDir();
				this.log("session", "Debug mode enabled");
			} else {
				this.log("session", "Debug mode disabled");
			}
		}
	}

	private ensureDir(): void {
		try {
			const dir = path.dirname(this.logPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
		} catch {
			// ignore
		}
	}

	log(category: string, message: string, details?: Record<string, unknown>): void {
		if (!this.enabled) return;

		const timestamp = new Date().toISOString();
		const prefix = `[${timestamp}] [${category}]`;
		const line = details
			? `${prefix} ${message} ${JSON.stringify(details, null, 2)}`
			: `${prefix} ${message}`;

		try {
			fs.appendFileSync(this.logPath, line + "\n");
		} catch {
			// ignore write failures
		}
	}

	getLogPath(): string {
		return this.logPath;
	}

	getLogContent(): string {
		try {
			return fs.readFileSync(this.logPath, "utf-8");
		} catch {
			return "";
		}
	}

	clearLog(): void {
		try {
			fs.writeFileSync(this.logPath, "");
		} catch {
			// ignore
		}
	}
}