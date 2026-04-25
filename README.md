![pi-badger header](https://github.com/garyjohnson/pi-badger/blob/main/badger-header.png)

# pi-badger

A quality gate extension for the [pi coding agent](https://github.com/badlogic/pi-mono). Badger automatically runs checks when files change and enforces a test-pass-release workflow.

## How It Works

Badger operates in three stages:

1. **Fast checks (`checksFast`)** — Run automatically at the end of each turn when watched files change. Typically configured as separate entries for lint, typecheck, and per-file tests. Each entry can use `fileFilter` to route only matching changed files to that script. Entries without `fileFilter` receive all changed files. Short-circuits on first failure. Failures are injected back to pi as steering messages — pi keeps working and fixes issues.

2. **Full checks (`checks`)** — Run automatically at `agent_end` when watched files have changed since the last successful check. Runs the complete test suite. If checks fail, pi is told to fix the failures and keeps working. Loops until all checks pass.

3. **Release** — Runs automatically after full checks pass. If the release fails, only the user is notified (pi doesn't try to fix release failures).

```
File changes detected → checksFast (per turn, async, fileFilter routes files)
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
/badger:setup
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
  "debug": false,
  "checksFast": [
    {
      "type": "script",
      "path": "scripts/lint",
      "fileFilter": ["*.ts", "*.tsx", "*.js", "*.jsx"],
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
      "fileFilter": ["*.test.ts", "*.spec.ts", "*.test.js", "*.spec.js"],
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
| `debug` | `boolean` | `false` | Enable debug mode — log detailed info to `.pi/badger-debug.log` |
| `checksFast` | `FastCheckEntry[]` | lint, typecheck, test_changed | Fast per-file checks (script or command). Short-circuits on first failure. |
| `checks` | `CheckEntry[]` | (see defaults) | Full test suite (script, command, or prompt) |
| `release` | `CheckEntry \| null` | (see defaults) | Release step (script, command, or prompt), omit to disable |

### FastCheckEntry

```json
{
  "type": "script",
  "path": "scripts/lint",
  "fileFilter": ["*.ts", "*.tsx"],
  "failurePrompt": "Fix the lint issues identified above and continue working."
}
```

Or with inline command:

```json
{
  "type": "command",
  "command": "npx eslint $CHANGED_FILES",
  "fileFilter": ["*.ts", "*.tsx"],
  "failurePrompt": "Fix the lint issues identified above and continue working."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"script" \| "command"` | Yes | Entry type. `"script"` runs an executable file, `"command"` runs a shell command string. |
| `path` | `string` | Yes (if `type` is `"script"`) | Path to the check script |
| `command` | `string` | Yes (if `type` is `"command"`) | Shell command to run. Use `$CHANGED_FILES` to insert changed file paths. |
| `fileFilter` | `string[]` | No | Glob patterns. Only changed files matching these patterns are passed to the script/command. If no files match, the entry is skipped entirely. Omit to receive all changed files. |
| `failurePrompt` | `string` | No | Message sent to pi on failure |

`fileFilter` uses [picomatch](https://github.com/micromatch/picomatch) glob patterns. Use it to route specific file types to specific fast checks — e.g., only `*.test.ts` files to the test runner, only `*.ts` files to the linter, only `e2e/**/*.spec.ts` to the e2e runner.

### Entry Types

**Script entry:**

Runs an executable script file. Changed files are passed as command-line arguments.

```json
{
  "type": "script",
  "path": "scripts/check",
  "failurePrompt": "Fix the failures and continue."
}
```

**Command entry:**

Runs a shell command directly via `sh -c`. No script file needed. Use `$CHANGED_FILES` in `checksFast` entries to insert changed file paths — it's replaced with a space-separated list of quoted paths. If `$CHANGED_FILES` is not present, changed files are appended to the end of the command.

```json
{
  "type": "command",
  "command": "bun test",
  "failurePrompt": "Fix the test failures and continue working."
}
```

With file filter:

```json
{
  "type": "command",
  "command": "npx eslint $CHANGED_FILES",
  "fileFilter": ["*.ts", "*.tsx"],
  "failurePrompt": "Fix the lint issues and continue working."
}
```

Shell features like pipes, `&&`, and redirects work:

```json
{
  "type": "command",
  "command": "npx tsc --noEmit && bun test",
  "failurePrompt": "Fix the failures and continue working."
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

## Debug Mode

Badger includes a debug mode that logs detailed information about every decision it makes — file changes detected, hash diffs, check execution, skipping reasons, and more.

### Enabling Debug Mode

There are three ways to enable debug mode:

1. **Config file** — Set `"debug": true` in `.pi/badger.json`
2. **Environment variable** — Set `BADGER_DEBUG=1` or `BADGER_DEBUG=true`
3. **Command** — Run `/badger:debug` to toggle debug mode on/off

```json
{
  "debug": true,
  "watchPatterns": ["src/**/*"],
  ...
}
```

### Debug Log

When debug mode is enabled, Badger writes a detailed log to `.pi/badger-debug.log` with:

- **Config loading** — what config was found, merged values, environment overrides
- **Session start** — file count, watch patterns, check counts
- **File change detection** — which files changed, change type (added/modified/deleted), hash diffs
- **Fast check evaluation** — which entries run, which are skipped, fileFilter matching
- **Script execution** — exit code, elapsed time, stdout/stderr (truncated to 500 chars)
- **Check and release results** — pass/fail, timing, output summaries
- **Abort and skip events** — why checks were skipped or cancelled, what superseded them
- **Cancellation details** — when a fast check is cancelled mid-execution because newer changes arrived, which entry was running, and why

Log entries include timestamps and categorized labels:

```
[2026-04-19T14:30:15.123Z] [session_start] Session starting {"cwd":"/project","debug":true,...}
[2026-04-19T14:30:15.200Z] [session_start] Initial hash map built {"fileCount":42}
[2026-04-19T14:30:45.500Z] [turn_end] File change detection {"changedCount":2,"changes":[...]}
[2026-04-19T14:30:45.501Z] [fast_check] Evaluating entry {"path":"scripts/lint","fileFilter":["*.ts"],...}
[2026-04-19T14:30:46.100Z] [fast_check] Script completed {"exitCode":0,"elapsedMs":599}
```

Debug output is also written to stderr (shows in pi's process output) and the log file.

### Debug Commands

| Command | Description |
|---------|-------------|
| `/badger:debug` | Toggle debug mode on (default) or off |
| `/badger:debug on` | Enable debug mode |
| `/badger:debug off` | Disable debug mode |
| `/badger:debug status` | Show current state: tracked files, pending changes, running status |
| `/badger:debug log` | Show last 100 lines of the debug log |
| `/badger:debug clear` | Clear the debug log file |

When debug mode is active, a `🐛 Debug ON` status indicator appears in the TUI footer.

### Status Command

`/badger:debug status` gives you a snapshot of Badger's current state:

```
🐛 Badger Debug Status
  Enabled: true
  Log path: /project/.pi/badger-debug.log
  Watch patterns: src/**/*, test/**/*
  Exclude patterns: (none)
  Files tracked: 42
  Last-pass files: 40
  Fast checks: 3 entries
  Full checks: 1 entries
  Has release: true
  Running checks: false
  Running release: false
  Pending changes: 2
    modified: src/foo.ts
    added: test/bar.test.ts
```

## Commands

| Command | Description |
|---------|-------------|
| `/badger:setup` | Configure Badger for this project |
| `/badger:enable` | Enable Badger automatic checks and release |
| `/badger:disable` | Disable Badger automatic checks and release |
| `/badger:check` | Manually trigger full checks |
| `/badger:release` | Manually trigger the release step |
| `/badger:debug` | Toggle debug mode, view log, show status |

## Scripts

### `scripts/lint`

Receives only files matching `fileFilter` (e.g., `*.ts`, `*.tsx`). Run the linter directly on the arguments:

```bash
#!/usr/bin/env bash
set -euo pipefail
CHANGED_FILES=("$@")
[ ${#CHANGED_FILES[@]} -eq 0 ] && exit 0
npx eslint "${CHANGED_FILES[@]}"
```

### `scripts/typecheck`

No `fileFilter` — runs on any change. Most type checkers check the whole project regardless of which files changed:

```bash
#!/usr/bin/env bash
set -euo pipefail
npx tsc --noEmit
```

### `scripts/test_changed`

Receives only files matching `fileFilter` (e.g., `*.test.ts`, `*.spec.ts`). Run the test runner on those files:

```bash
#!/usr/bin/env bash
set -euo pipefail
CHANGED_FILES=("$@")
[ ${#CHANGED_FILES[@]} -eq 0 ] && exit 0
npx vitest run "${CHANGED_FILES[@]}"
```

Note: fast checks only receive files that changed. If a source file changes but its test file didn't, the fast test won't catch that — the full `checks` suite at `agent_end` covers it.

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

- **Fast checks are async** — they run in the background after each turn. If new changes arrive before fast checks complete, the previous run is cancelled (the script process is killed) and a new one starts. Debug mode logs every cancellation.
- **Fast checks short-circuit** — if the first entry in `checksFast` fails, subsequent entries are skipped.
- **Full checks run all entries** — every entry in `checks` runs, and all failures are reported together.
- **The check loop is unbounded** — pi keeps working until all checks pass or the user aborts with Esc/Ctrl+C.
- **File hashing** — Badger uses content hashing (not git) to detect changes, so it works in any project.
- **Release failure is user-facing** — pi does not try to fix release issues; only the user sees the failure output.

## License

MIT