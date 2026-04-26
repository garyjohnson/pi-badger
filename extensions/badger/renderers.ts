/**
 * Badger — Message renderers for TUI display
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

/** Coerce message.content to a plain string for regex matching. */
function contentToString(content: string | (import("@mariozechner/pi-ai").TextContent | import("@mariozechner/pi-ai").ImageContent)[] | undefined): string {
	if (!content) return "";
	if (typeof content === "string") return content;
	// Array of content blocks — extract text from TextContent blocks
	return content
		.filter((block): block is import("@mariozechner/pi-ai").TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

/** Extract the check label from a fast check failure message.
 *  Format: "Badger fast check failed (LABEL) on files: ..."
 */
export function extractFastLabel(content: string): string | null {
	const match = content.match(/Badger fast check failed \(([^)]+)\)/);
	return match ? match[1] : null;
}

/** Extract the first check label from a full check failure message.
 *  Format: "**LABEL** failed (exit code N):"
 */
export function extractCheckLabel(content: string): string | null {
	const match = content.match(/\*\*([^*]+)\*\* failed/);
	return match ? match[1] : null;
}

/** Extract the release label from a release failure message.
 *  Format: "Badger release failed (LABEL):"
 */
export function extractReleaseLabel(content: string): string | null {
	const match = content.match(/Badger release failed \(([^)]+)\)/);
	return match ? match[1] : null;
}

/** Count check failures in a full check failure message.
 *  Each failure starts with **LABEL** failed
 */
export function countCheckFailures(content: string): number {
	const matches = content.match(/\*\*[^*]+\*\* failed/g);
	return matches ? matches.length : 0;
}

// ---------------------------------------------------------------------------
// Failure message formatting
// ---------------------------------------------------------------------------

/** A single check failure entry. */
export interface CheckFailure {
	label: string;
	exitCode: number;
	output: string;
	failurePrompt: string;
}

/** Format a single check failure as a markdown block. */
export function formatCheckFailure(failure: CheckFailure): string {
	return `**${failure.label}** failed (exit code ${failure.exitCode}):\n\n\`\`\`\n${failure.output}\n\`\`\`\n\n${failure.failurePrompt}`;
}

/** Format a single-failure check message (used when fastFail is true). */
export function formatSingleFailureMessage(failure: CheckFailure): string {
	return `Badger checks failed:\n\n${formatCheckFailure(failure)}`;
}

/** Format a multi-failure check message (used when fastFail is false).
 *  Returns a single-failure message if only one failure is provided,
 *  or a combined message if multiple are provided.
 *  Throws if called with an empty array — callers should check first.
 */
export function formatMultiFailureMessage(failures: CheckFailure[]): string {
	if (failures.length === 0) {
		throw new Error("formatMultiFailureMessage requires at least one failure");
	}
	const failureMessages = failures.map(formatCheckFailure).join("\n\n");
	return `Badger checks failed:\n\n${failureMessages}`;
}

// `expanded` is toggled by pi's "expand tools" keybinding; collapsed shows just the headline, expanded appends message.content.
export function registerRenderers(pi: ExtensionAPI): void {
	pi.registerMessageRenderer("badger-fast-failure", (message, options, theme) => {
		const { expanded } = options;
		const contentStr = contentToString(message.content);
		const label = extractFastLabel(contentStr);
		let text = label
			? theme.fg("error", `☠ ${label}`)
			: theme.fg("error", "☠ Badger fast check failed");
		if (expanded && contentStr) {
			text += "\n" + contentStr;
		}
		return new Text(text, 0, 0);
	});

	pi.registerMessageRenderer("badger-check-failure", (message, options, theme) => {
		const { expanded } = options;
		const contentStr = contentToString(message.content);
		const label = extractCheckLabel(contentStr);
		const count = countCheckFailures(contentStr);
		let text: string;
		if (label && count === 1) {
			text = theme.fg("error", `☠ ${label}`);
		} else if (count > 1) {
			text = theme.fg("error", `☠ ${count} checks failed`);
		} else {
			text = theme.fg("error", "☠ Badger check failed");
		}
		if (expanded && contentStr) {
			text += "\n" + contentStr;
		}
		return new Text(text, 0, 0);
	});

	pi.registerMessageRenderer("badger-release-failure", (message, options, theme) => {
		const { expanded } = options;
		const contentStr = contentToString(message.content);
		const label = extractReleaseLabel(contentStr);
		let text = label
			? theme.fg("error", `☠ ${label}`)
			: theme.fg("error", "☠ Badger release failed");
		if (expanded && contentStr) {
			text += "\n" + contentStr;
		}
		return new Text(text, 0, 0);
	});

	pi.registerMessageRenderer("badger-check-prompt", (message, options, theme) => {
		let text = theme.fg("accent", "📋 Badger check prompt");
		if (options.expanded && message.content) {
			text += "\n" + contentToString(message.content);
		}
		return new Text(text, 0, 0);
	});

	pi.registerMessageRenderer("badger-release-prompt", (message, options, theme) => {
		let text = theme.fg("accent", "📋 Badger release prompt");
		if (options.expanded && message.content) {
			text += "\n" + contentToString(message.content);
		}
		return new Text(text, 0, 0);
	});
}