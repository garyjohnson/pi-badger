# pi-badger

A quality gate extension for the [pi coding agent](https://github.com/badlogic/pi-mono). Badger automatically runs checks when files change and enforces a test-pass-release workflow.

## How It Works

Badger operates in three stages:

1. **Fast checks (`checksFast`)** — Run automatically at the end of each turn when watched files change. Typically configured as separate entries for lint, typecheck, and per-file tests. Each script receives changed file paths as arguments and operates only on those files. Short-circuits on first failure. Failures are injected back to pi as steering messages — pi keeps working and fixes issues.

2. **Full checks (`checks`)** — Run automatically at `agent_end` when watched files have changed since the last successful check. Runs the complete test suite. If checks fail, pi is told to fix the failures and keeps working. Loops until all checks pass.

3. **Release** — Runs automatically after full checks pass. If the release fails, only the user is notified (pi doesn't try to fix release failures).

```
File changes detected → checksFast (per turn, async)
Agent finishes → checks (full suite)
  └── pass → release
  └── fail → pi fixes → repeat
```

## Installation

```bash
pi install git:github.com/garyjohnson/pi-badger
```

Or add to `.pi/settings.json`:

```json
{
  "packages": ["git:github.com/garyjohnson/pi-badger"]
}
```

## Setup

Run the setup command to analyze your project and create configuration:

```
/badger-setup
```

Or use the prompt template:

```
/badger-init
```

This will:
- Detect your language, test framework, and linter
- Propose appropriate defaults
- Create `.pi/badger.json`
- Create stub scripts in `scripts/`

## Configuration

Badger reads configuration from `.pi/badger.json` in your project root:

```json
{
  "watchPatterns": ["src/**/*", "test/**/*", "lib/**/*", "pkg/**/*"],
  "excludePatterns": ["**/*.lock"],
  "notifyWithoutConfig": true,
  "checksFast": [
    {
      "type": "script",
      "path": "scripts/lint",
      "failurePrompt": "Fix the lint issues identified above and continue working."
    },
    {
      "type": "script",
      "path": "scripts/typecheck",
      "failurePrompt": "Fix the type errors identified above and continue working."
    },
    {
      "type": "script",
      "path": "scripts/test_changed",
      "failurePrompt": "Fix the test failures identified above and continue working."
    }
  ],
  "checks": [
    {
      "type": "script",
      "path": "scripts/check",
      "failurePrompt": "Fix the test failures and continue working."
    }
  ],
  "release": {
    "type": "script",
    "path": "scripts/release",
    "failurePrompt": "The release failed. Review the errors above."
  }
}
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `watchPatterns` | `string[]` | `["src/**/*", "test/**/*", "lib/**/*", "pkg/**/*"]` | Glob patterns for files to watch (must include test dirs) |
| `excludePatterns` | `string[]` | `[]` | Glob patterns to exclude — keep minimal (only lock/gen files) |
| `notifyWithoutConfig` | `boolean` | `true` | Show setup notification when no config found |
| `checksFast` | `FastCheckEntry[]` | lint, typecheck, test\_changed | Fast per-file checks (script only). Short-circuits on first failure. |
| `checks` | `CheckEntry[]` | (see defaults) | Full test suite (script or prompt) |
| `release` | `CheckEntry \| null` | (see defaults) | Release step (script or prompt), omit to disable |

### Entry Types

**Script entry:**

```json
{
  "type": "script",
  "path": "scripts/check",
  "failurePrompt": "Fix the failures and continue."
}
```

**Prompt entry:**

```json
{
  "type": "prompt",
  "content": "Review the changes and ensure the changelog is updated."
}
```

Prompt entries are fire-and-forget — they send instructions to pi but don't have a pass/fail gate. Use them for steps that need LLM judgment.

### Disabling Steps

- Remove `release` or set to `null` to skip auto-release
- Remove entries from `checksFast` or `checks` arrays to disable individual checks
- Set `checksFast: []` to disable fast checks entirely

## Commands

| Command | Description |
|---------|-------------|
| `/badger` | Manually trigger full checks |
| `/badger-release` | Manually trigger the release step |
| `/badger-setup` | Configure Badger for this project |

## Scripts

### `scripts/lint`

Receives changed file paths as arguments. Filters to lintable files and runs the linter on only those.

```bash
#!/usr/bin/env bash
set -euo pipefail
CHANGED_FILES=("$@")
# Filter to source files
SOURCE_FILES=()
for f in "${CHANGED_FILES[@]}"; do
  case "$f" in
    *.ts|*.tsx|*.js|*.jsx) SOURCE_FILES+=("$f") ;;
  esac
done
[ ${#SOURCE_FILES[@]} -eq 0 ] && exit 0
npx eslint "${SOURCE_FILES[@]}"
```

### `scripts/typecheck`

Receives changed file paths as arguments (for reference). Most type checkers run project-wide.

```bash
#!/usr/bin/env bash
set -euo pipefail
npx tsc --noEmit
```

### `scripts/test_changed`

Receives changed file paths as arguments. Uses the test runner's built-in related-file mode to find and run affected tests — don't manually map source files to test files.

```bash
#!/usr/bin/env bash
set -euo pipefail
CHANGED_FILES=("$@")
[ ${#CHANGED_FILES[@]} -eq 0 ] && exit 0
npx vitest run --related "${CHANGED_FILES[@]}"
```

### `scripts/check`

No arguments. Runs the full test suite.

```bash
#!/usr/bin/env bash
set -euo pipefail
npx vitest run
```

### `scripts/release`

No arguments. Runs release steps.

```bash
#!/usr/bin/env bash
set -euo pipefail
npm run build
npm publish
```

Release failures are reported to the user only — pi does not attempt to fix them.

## Behavior Details

- **Fast checks are async** — they run in the background after each turn. If new changes arrive before fast checks complete, the previous run is aborted and a new one starts.
- **Fast checks short-circuit** — if the first entry in `checksFast` fails, subsequent entries are skipped.
- **Full checks run all entries** — every entry in `checks` runs, and all failures are reported together.
- **The check loop is unbounded** — pi keeps working until all checks pass or the user aborts with Esc/Ctrl+C.
- **File hashing** — Badger uses content hashing (not git) to detect changes, so it works in any project.
- **Release failure is user-facing** — pi does not try to fix release issues; only the user sees the failure output.

## License

MIT