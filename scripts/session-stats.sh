#!/usr/bin/env bash
# session-stats.sh — Convenience wrapper around session-stats.ts
#
# Usage:
#   ./scripts/session-stats.sh              # All sessions for this repo
#   ./scripts/session-stats.sh --latest     # Only the latest session

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bun "$SCRIPT_DIR/session-stats.ts" "$@"