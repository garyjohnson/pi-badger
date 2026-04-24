/**
 * Badger — Message renderers for TUI display
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

// `expanded` is toggled by pi's "expand tools" keybinding; collapsed shows just the headline, expanded appends message.content.
export function registerRenderers(pi: ExtensionAPI): void {
	pi.registerMessageRenderer("badger-fast-failure", (message, options, theme) => {
		const { expanded } = options;
		let text = theme.fg("error", "☠ Badger fast check failed");
		if (expanded && message.content) {
			text += "\n" + message.content;
		}
		return new Text(text, 0, 0);
	});

	pi.registerMessageRenderer("badger-check-failure", (message, options, theme) => {
		const { expanded } = options;
		let text = theme.fg("error", "☠ Badger check failed");
		if (expanded && message.content) {
			text += "\n" + message.content;
		}
		return new Text(text, 0, 0);
	});

	pi.registerMessageRenderer("badger-release-failure", (message, options, theme) => {
		const { expanded } = options;
		let text = theme.fg("error", "☠ Badger release failed");
		if (expanded && message.content) {
			text += "\n" + message.content;
		}
		return new Text(text, 0, 0);
	});

	pi.registerMessageRenderer("badger-check-prompt", (message, options, theme) => {
		let text = theme.fg("accent", "📋 Badger check prompt");
		if (options.expanded && message.content) {
			text += "\n" + message.content;
		}
		return new Text(text, 0, 0);
	});

	pi.registerMessageRenderer("badger-release-prompt", (message, options, theme) => {
		let text = theme.fg("accent", "📋 Badger release prompt");
		if (options.expanded && message.content) {
			text += "\n" + message.content;
		}
		return new Text(text, 0, 0);
	});
}