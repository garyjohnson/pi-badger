/**
 * Badger — Tail overlay for streaming command output
 *
 * Shows a non-capturing floating popover with the last N lines of a
 * running check/release command's output.  Uses child_process.spawn for
 * streaming instead of pi.exec (which buffers).
 *
 * Only used for full checks (not fast checks).
 */

import { spawn } from "node:child_process";
import type { Component, TUI } from "@mariozechner/pi-tui";
import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth, matchesKey, Key } from "@mariozechner/pi-tui";

// ---------------------------------------------------------------------------
// Tail overlay component
// ---------------------------------------------------------------------------

/**
 * A floating overlay that shows the tail of a running command's output.
 * Used with ctx.ui.custom({ overlay: true, overlayOptions: {...} }).
 * The user can scroll with arrow keys and close with Escape.
 */
export class TailOverlay implements Component {
	private lines: string[] = [];
	private scrollOffset = 0;
	private isFinished = false;
	private exitCode: number | null = null;
	private startTime = Date.now();

	constructor(
		private label: string,
		private maxVisibleLines: number,
		private theme: Theme,
		private onClose: () => void,
	) {}

	/** Add a line of output. */
	addOutput(line: string): void {
		// Strip ANSI control sequences that would break the overlay box
		const cleaned = stripAnsi(line);
		this.lines.push(cleaned);
		// Keep only the last `maxVisibleLines * 3` lines to bound memory
		const bufferMax = this.maxVisibleLines * 3;
		if (this.lines.length > bufferMax) {
			this.lines = this.lines.slice(this.lines.length - bufferMax);
		}
		// Auto-scroll to bottom
		this.scrollOffset = Math.max(0, this.lines.length - this.maxVisibleLines);
	}

	/** Mark the command as finished. */
	setFinished(exitCode: number | null): void {
		this.isFinished = true;
		this.exitCode = exitCode;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.onClose();
		} else if (matchesKey(data, Key.up)) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
		} else if (matchesKey(data, Key.down)) {
			const maxScroll = Math.max(0, this.lines.length - this.maxVisibleLines);
			this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 1);
		} else if (matchesKey(data, Key.end)) {
			this.scrollOffset = Math.max(0, this.lines.length - this.maxVisibleLines);
		} else if (matchesKey(data, Key.home)) {
			this.scrollOffset = 0;
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		if (!th) return [];
		const innerW = Math.max(1, width - 2);
		const result: string[] = [];
		const border = (c: string) => th.fg("border", c);

		// Header bar
		const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
		const mins = Math.floor(elapsed / 60);
		const secs = elapsed % 60;
		const timeStr = `${mins}:${String(secs).padStart(2, "0")}`;

		let statusIcon: string;
		let statusColor: ThemeColor;
		if (this.isFinished) {
			if (this.exitCode === 0) {
				statusIcon = "✓";
				statusColor = "success";
			} else {
				statusIcon = "✗";
				statusColor = "error";
			}
		} else {
			statusIcon = "●";
			statusColor = "warning";
		}

		const titleText = th.fg("accent", `🦡 ${this.label}`) + " " + th.fg(statusColor, `${statusIcon} ${timeStr}`);
		const titleLine = border("╭") + truncateToWidth(` ${titleText} `, innerW, "…", true) + border("╮");
		result.push(titleLine);

		// Content lines
		const visibleLines = this.lines.slice(
			this.scrollOffset,
			this.scrollOffset + this.maxVisibleLines,
		);
		for (const line of visibleLines) {
			result.push(border("│") + truncateToWidth(` ${line}`, innerW, "…", true) + border("│"));
		}

		// Pad remaining lines
		for (let i = visibleLines.length; i < this.maxVisibleLines; i++) {
			result.push(border("│") + " ".repeat(innerW) + border("│"));
		}

		// Footer
		const helpText = this.isFinished
			? th.fg("dim", " ✓ Done — Esc close")
			: th.fg("dim", " ↑↓ scroll · Esc close");
		result.push(border("│") + truncateToWidth(` ${helpText}`, innerW, "…", true) + border("│"));
		result.push(border(`╰${"─".repeat(innerW)}╯`));

		return result;
	}

	invalidate(): void {}
}

// ---------------------------------------------------------------------------
// Streaming runner
// ---------------------------------------------------------------------------

/**
 * Result of a streamed command execution.
 * Matches the RunResult shape from runner.ts for compatibility.
 */
export interface StreamedRunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	aborted: boolean;
	elapsed?: number;
}

/**
 * Run a command with streaming output to a TailOverlay.
 *
 * Spawns the command via child_process, pipes stdout/stderr lines
 * into the overlay component, and returns the final result when done.
 * When finished, waits 1.5s so the user can see the exit status,
 * then calls done() to close the overlay.
 */
export function runWithTailOverlay(
	command: string,
	cwd: string,
	overlay: TailOverlay,
	tui: TUI,
	done: (result: StreamedRunResult | null) => void,
	signal?: AbortSignal,
): void {
	const startTime = Date.now();
	let stdout = "";
	let stderr = "";
	let resolved = false;

	const proc = spawn("sh", ["-c", command], {
		cwd,
		env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
		stdio: ["ignore", "pipe", "pipe"],
	});

	// Forward stdout lines to overlay
	proc.stdout?.on("data", (data: Buffer) => {
		const text = data.toString();
		stdout += text;
		for (const line of text.split("\n")) {
			if (line) overlay.addOutput(line);
		}
		tui.requestRender();
	});

	// Forward stderr lines to overlay
	proc.stderr?.on("data", (data: Buffer) => {
		const text = data.toString();
		stderr += text;
		for (const line of text.split("\n")) {
			if (line) overlay.addOutput(line);
		}
		tui.requestRender();
	});

	proc.on("close", (code) => {
		if (resolved) return;
		resolved = true;
		const exitCode = code ?? 1;
		overlay.setFinished(exitCode);
		tui.requestRender();

		const result: StreamedRunResult = {
			exitCode,
			stdout,
			stderr,
			aborted: false,
			elapsed: Date.now() - startTime,
		};

		// Auto-close overlay after a short delay so the user can see
		// the exit status, then resolve the custom() call
		setTimeout(() => {
			done(result);
		}, 1500);
	});

	proc.on("error", (err) => {
		if (resolved) return;
		resolved = true;
		overlay.setFinished(1);
		const errMsg = err.message;
		stderr += errMsg;
		overlay.addOutput(`Error: ${errMsg}`);
		tui.requestRender();

		const result: StreamedRunResult = {
			exitCode: 1,
			stdout,
			stderr,
			aborted: false,
			elapsed: Date.now() - startTime,
		};

		setTimeout(() => {
			done(result);
		}, 1500);
	});

	// Handle abort signal from external source
	if (signal) {
		if (signal.aborted) {
			proc.kill("SIGTERM");
			if (!resolved) {
				resolved = true;
				done({
					exitCode: -1,
					stdout,
					stderr,
					aborted: true,
					elapsed: Date.now() - startTime,
				});
			}
			return;
		}
		signal.addEventListener("abort", () => {
			proc.kill("SIGTERM");
			if (!resolved) {
				resolved = true;
				done({
					exitCode: -1,
					stdout,
					stderr,
					aborted: true,
					elapsed: Date.now() - startTime,
				});
			}
		}, { once: true });
	}

	// When done is called with null, the user aborted (pressed ESC) — kill the process
	const originalDone = done;
	done = (result) => {
		if (result === null && !resolved) {
			resolved = true;
			proc.kill("SIGTERM");
			originalDone({
				exitCode: -1,
				stdout,
				stderr,
				aborted: true,
				elapsed: Date.now() - startTime,
			});
			return;
		}
		originalDone(result);
	};
}

// ---------------------------------------------------------------------------
// ANSI stripping utility
// ---------------------------------------------------------------------------

/** Strip common ANSI escape sequences from a string. */
export function stripAnsi(str: string): string {
	// eslint-disable-next-line no-control-regex
	return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
		.replace(/\x1b\][^\x07]*\x07/g, "") // OSC sequences terminated by BEL
		.replace(/\x1b\][^\x1b]*\x1b\\/g, "") // OSC sequences terminated by ST (ESC \)
		.replace(/\x1b\[[0-9;]*m/g, ""); // SGR sequences (colors)
}