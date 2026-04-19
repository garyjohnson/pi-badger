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

### Step 2: Propose configuration to the user

Based on project detection, propose defaults for each config field. Ask the user to confirm or customize:

| Field | Description | Suggested Default |
|-------|-------------|-------------------|
| `watchPatterns` | File patterns to watch for changes | Based on language and project structure (e.g., `["src/**/*", "test/**/*"]`) |
| `excludePatterns` | File patterns to exclude from watching | `["**/*.lock"]` (keep minimal — only lock files and generated artifacts) |
| `checksFast` | Fast per-file checks | Separate entries for lint, typecheck, and per-file test (see below) |
| `checks` | Full test suite | Based on detected test framework |
| `release` | Release step | Script or prompt based on project |

**Important rules**:

- `watchPatterns` MUST include all source AND test directories. Changing a test file should trigger checks.
- `excludePatterns` should be minimal — only lock files and generated artifacts. Never exclude `**/*.json` (it would skip `package.json`, `tsconfig.json`, etc.) or test files.
- `checksFast` entries each operate on the changed files only. They should target specific concerns — one entry for linting, one for type checking, one for running relevant test files — so failures are clear and actionable.
- All `checksFast` scripts receive the list of changed file paths as arguments. Each tool must be able to accept specific file paths. If a tool only runs project-wide (e.g., `tsc --noEmit`), it still goes in `checksFast` but the script runs it without the file arguments.

Ask the user: "Here's what I detected and recommend. Should I proceed with these defaults, or would you like to customize any field?"

### Step 3: Write `.pi/badger.json`

Create `.pi/badger.json` in the project root with the confirmed configuration.

The `checksFast` array should have **one entry per check type**, each with its own script. This gives clear failure messages and lets each check run independently. The typical entries for a JS/TS project are:

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

**Adapt per language.** Not all projects have all three fast checks. Include only what applies:

| Language | Lint | Typecheck | Per-file test |
|----------|------|-----------|---------------|
| JS/TS | eslint / ruff | tsc --noEmit | jest/vitest on changed test files only |
| Python | ruff check | mypy | pytest on changed test files only |
| Rust | clippy | — | cargo test for changed module |
| Go | — | — | go test for changed package |
| Ruby | rubocop | — | rspec for changed spec files |

Only include entries for tools the project actually uses. If there's no linter, don't create a lint entry. If there's no type checker, don't create a typecheck entry.

### Step 4: Write check scripts

Create executable scripts in the project's `scripts/` directory. Each script should:

- Accept changed file paths as arguments (for checksFast scripts)
- Return exit code 0 on success, non-zero on failure
- Print useful output (errors to stderr, progress to stdout)
- Operate **only on the changed files** when the tool supports it

#### `scripts/lint` — Lint changed files

Receives changed file paths as arguments, filters to lintable files, and runs the linter on only those:

```bash
#!/usr/bin/env bash
# Badger lint check — lints changed files only
# Arguments: changed file paths (from Badger)
# Exit 0 on success, non-zero on failure
set -euo pipefail

CHANGED_FILES=("$@")

# Filter to lintable source files (adapt for your project)
SOURCE_FILES=()
for f in "${CHANGED_FILES[@]}"; do
  case "$f" in
    *.ts|*.tsx|*.js|*.jsx) SOURCE_FILES+=("$f") ;;
  esac
done

if [ ${#SOURCE_FILES[@]} -eq 0 ]; then
  echo "No source files to lint"
  exit 0
fi

echo "Linting ${#SOURCE_FILES[@]} file(s)..."
npx eslint "${SOURCE_FILES[@]}"
```

#### `scripts/typecheck` — Type check

Receives changed file paths as arguments (for reference), but most type checkers run project-wide:

```bash
#!/usr/bin/env bash
# Badger typecheck — runs type checking
# Arguments: changed file paths (from Badger; ignored by tsc)
# Exit 0 on success, non-zero on failure
set -euo pipefail

CHANGED_FILES=("$@")
echo "Running type checks (${#CHANGED_FILES[@]} file(s) changed)..."
npx tsc --noEmit
```

#### `scripts/test_changed` — Run tests for changed files

Receives changed file paths as arguments. Use the test runner's built-in related-file mode to find and run affected tests — don't try to manually map source files to test files:

```bash
#!/usr/bin/env bash
# Badger per-file test — runs tests related to changed files
# Arguments: changed file paths (from Badger)
# Exit 0 on success, non-zero on failure
set -euo pipefail

CHANGED_FILES=("$@")

if [ ${#CHANGED_FILES[@]} -eq 0 ]; then
  echo "No changed files to test"
  exit 0
fi

echo "Running tests related to ${#CHANGED_FILES[@]} changed file(s)..."
# Vitest/Jest can find related tests given source files:
npx vitest run --related "${CHANGED_FILES[@]}"
# For runners without --related, you can filter to test files:
#   npx jest --findRelatedTests --changed "${CHANGED_FILES[@]}"
#   pytest "${CHANGED_FILES[@]}"
```

Only include entries for tools the project actually uses. If there's no linter, don't create a lint entry. If there's no type checker, don't create a typecheck entry.

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