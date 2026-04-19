---
name: badger-setup
description: Configure the Badger quality gate extension for this project. Creates .pi/badger.json and stub check scripts. Run when you want to set up automated testing and release checking for a pi coding agent project.
---

# Badger Setup

Configure Badger for this project. This skill will:

1. **Analyze the project** — detect language, test framework, linter, and build tools
2. **Propose a configuration** — suggest watchPatterns, check scripts, and release steps
3. **Create the config** — write `.pi/badger.json`
4. **Create check scripts** — write executable check scripts in `scripts/`

## Steps

### Step 1: Analyze the project

Look at the project root for:

- **Language**: Check for `package.json` (JS/TS), `requirements.txt` / `pyproject.toml` (Python), `Cargo.toml` (Rust), `go.mod` (Go), `Gemfile` / `*.gemspec` (Ruby), `pom.xml` / `build.gradle` (Java), etc.
- **Test framework**: `jest`, `vitest`, `pytest`, `cargo test`, `go test`, `rspec`, etc.
- **Linter/formatter**: `eslint`, `prettier`, `ruff`, `mypy`, `clippy`, etc.
- **Build tool**: `tsc`, `webpack`, `vite`, `setuptools`, `cargo`, etc.
- **Existing scripts**: Check if a `scripts/` directory already exists
- **Test file conventions**: How are test files named? Colocated (`.test.ts`, `.spec.ts`) or separate dirs (`tests/test_*.py`, `__tests__/`)? E2e tests?

### Step 2: Propose configuration to the user

Based on project detection, propose defaults for each config field. Ask the user to confirm or customize:

| Field | Description | Suggested Default |
|-------|-------------|-------------------|
| `watchPatterns` | File patterns to watch for changes | Based on language and project structure (e.g., `["src/**/*", "test/**/*"]`) |
| `excludePatterns` | File patterns to exclude from watching | `["**/*.lock"]` (keep minimal — only lock files and generated artifacts) |
| `checksFast` | Fast per-file checks | Separate entries with `fileFilter` (see below) |
| `checks` | Full test suite | Based on detected test framework |
| `release` | Release step | Script or prompt based on project |

**Important rules**:

- `watchPatterns` MUST include all source AND test directories. Changing a test file should trigger checks.
- `excludePatterns` should be minimal — only lock files and generated artifacts. Never exclude `**/*.json` (it would skip `package.json`, `tsconfig.json`, etc.) or test files.
- `checksFast` entries target specific concerns (lint, typecheck, tests) and use `fileFilter` to route relevant files to each script.
- Each `checksFast` script receives only the changed files matching its `fileFilter`. If no files match, the entry is skipped entirely.
- Entries without `fileFilter` receive all changed files and always run.

Ask the user: "Here's what I detected and recommend. Should I proceed with these defaults, or would you like to customize any field?"

### Step 3: Write `.pi/badger.json`

Create `.pi/badger.json` in the project root with the confirmed configuration.

The `checksFast` array should have **one entry per check type**, each with `fileFilter` to route only relevant changed files to that script. This gives clear failure messages, lets each check run independently, and avoids running e.g. the linter on test files or the test runner on source files.

**Example — JS/TS project with unit tests:**

```json
{
  "watchPatterns": ["src/**/*", "test/**/*", "lib/**/*", "pkg/**/*"],
  "excludePatterns": ["**/*.lock"],
  "notifyWithoutConfig": true,
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

**Example — JS/TS project with separate unit and e2e tests:**

```json
{
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
      "path": "scripts/test_unit",
      "fileFilter": ["*.test.ts", "*.test.js", "**/tests/**/*.test.ts"],
      "failurePrompt": "Fix the unit test failures identified above and continue working."
    },
    {
      "type": "script",
      "path": "scripts/test_e2e",
      "fileFilter": ["e2e/**/*.spec.ts", "*.e2e.ts"],
      "failurePrompt": "Fix the e2e test failures identified above and continue working."
    }
  ]
}
```

**Adapt per language.** `fileFilter` patterns vary by how the project names its test files:

| Language | Lint filter | Typecheck filter | Test file filter |
|----------|-------------|-----------------|------------------|
| JS/TS | `*.ts`, `*.tsx`, `*.js`, `*.jsx` | (no filter — runs on all changes) | `*.test.ts`, `*.spec.ts`, `*.test.js`, `*.spec.js` |
| Python | `*.py` | (no filter) | `tests/test_*.py`, `tests/*_test.py` |
| Rust | `*.rs` | — | — |
| Go | `*.go` | — | `*_test.go` |
| Ruby | `*.rb` | — | `*_spec.rb` |

Only include entries for tools the project actually uses. If there's no linter, don't create a lint entry. If there's no type checker, don't create a typecheck entry.

### Step 4: Write check scripts

Create executable scripts in the project's `scripts/` directory. Each script should:

- Accept changed file paths as arguments (for `checksFast` scripts, these are already filtered by `fileFilter`)
- Return exit code 0 on success, non-zero on failure
- Print useful output (errors to stderr, progress to stdout)

Because `fileFilter` handles the routing, scripts can be simple — they receive only the files they care about.

#### `scripts/lint` — Lint changed files

Receives only files matching `fileFilter` (e.g., `*.ts`, `*.tsx`). Run the linter directly on those files:

```bash
#!/usr/bin/env bash
# Badger lint check
# Arguments: changed file paths (already filtered by fileFilter)
# Exit 0 on success, non-zero on failure
set -euo pipefail

CHANGED_FILES=("$@")

if [ ${#CHANGED_FILES[@]} -eq 0 ]; then
  echo "No files to lint"
  exit 0
fi

echo "Linting ${#CHANGED_FILES[@]} file(s)..."
npx eslint "${CHANGED_FILES[@]}"
```

#### `scripts/typecheck` — Type check

No `fileFilter` — runs on any change. Most type checkers check the whole project regardless of which files changed:

```bash
#!/usr/bin/env bash
# Badger typecheck
# Arguments: changed file paths (not used by tsc)
# Exit 0 on success, non-zero on failure
set -euo pipefail

CHANGED_FILES=("$@")
echo "Running type checks (${#CHANGED_FILES[@]} file(s) changed)..."
npx tsc --noEmit
```

#### `scripts/test_changed` — Run tests for changed test files

Receives only files matching `fileFilter` (e.g., `*.test.ts`, `*.spec.ts`). Run the test runner on those files:

```bash
#!/usr/bin/env bash
# Badger per-file test
# Arguments: changed test file paths (already filtered by fileFilter)
# Exit 0 on success, non-zero on failure
set -euo pipefail

CHANGED_FILES=("$@")

if [ ${#CHANGED_FILES[@]} -eq 0 ]; then
  echo "No test files changed"
  exit 0
fi

echo "Running ${#CHANGED_FILES[@]} test file(s)..."
npx vitest run "${CHANGED_FILES[@]}"
```

Note: scripts only receive files that changed. If a source file changes but its test file didn't, the fast test won't catch that — the full `checks` suite at `agent_end` covers it.

#### `scripts/check` — Full test suite

Runs the complete test suite, no arguments:

```bash
#!/usr/bin/env bash
# Badger full check — runs the complete test suite
# No arguments
# Exit 0 on success, non-zero on failure
set -euo pipefail

echo "Running full checks..."
npx vitest run
echo "All checks passed"
```

#### `scripts/release` — Release

Runs release steps, no arguments:

```bash
#!/usr/bin/env bash
# Badger release script
# Runs release steps (version bump, build, publish, deploy)
# No arguments
# Exit 0 on success, non-zero on failure
set -euo pipefail

echo "Running release..."
# TODO: Add your release commands here
# Examples:
#   npm version patch && npm publish          # Node package
#   python -m build && twine upload dist/*    # Python package
#   cargo publish                             # Rust crate
echo "Release complete"
```

After creating scripts, make them executable: `chmod +x scripts/*`

### Notes

- If a `checksFast`, `checks`, or `release` entry uses `"type": "prompt"`, no script is needed. The `content` field contains the prompt text sent to the agent.
- Customize `failurePrompt` in the config to change what the agent is told when a check fails.
- Set any top-level key to `null` or omit it to disable that step (e.g., remove `release` to skip auto-release).
- Each `checksFast` entry short-circuits on failure — if the lint entry fails, typecheck and test_changed entries are skipped. This keeps feedback fast and focused.