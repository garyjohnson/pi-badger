---
name: badger-setup
description: Configure the Badger quality gate extension for this project. Creates .pi/badger.json and stub check scripts. Run when you want to set up automated testing and release checking for a pi coding agent project.
---

# Badger Setup

Configure Badger for this project. This skill will:

1. **Analyze the project** — detect language, test framework, linter, and build tools
2. **Propose a configuration** — suggest watchPatterns, check scripts, and release steps
3. **Create the config** — write `.pi/badger.json`
4. **Create stub scripts** — write executable check scripts in `scripts/`

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
| `watchPatterns` | File patterns to watch for changes | Based on language (e.g., `["src/**/*"]`) |
| `excludePatterns` | File patterns to exclude | `["**/*.md", "**/*.json", "**/*.lock"]` |
| `checksFast` | Fast per-file checks (lint, typecheck) | Based on detected linter |
| `checks` | Full test suite | Based on detected test framework |
| `release` | Release step | Script or prompt based on project |

Ask the user: "Here's what I detected and recommend. Should I proceed with these defaults, or would you like to customize any field?"

### Step 3: Write `.pi/badger.json`

Create `.pi/badger.json` in the project root with the confirmed configuration.

Example config structure:

```json
{
  "watchPatterns": ["src/**/*", "lib/**/*", "pkg/**/*"],
  "excludePatterns": ["**/*.md", "**/*.json", "**/*.lock"],
  "notifyWithoutConfig": true,
  "checksFast": [
    {
      "type": "script",
      "path": "scripts/check_fast",
      "failurePrompt": "Fix the issues identified above and continue working."
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

### Step 4: Write stub scripts

Create executable scripts in the project's `scripts/` directory. Each script should:

- Accept the appropriate arguments (`check_fast` receives changed file paths)
- Return exit code 0 on success, non-zero on failure
- Print useful output (errors to stderr, progress to stdout)
- Include a comment explaining what to customize

**`scripts/check_fast`** — Fast checks on changed files:

```bash
#!/usr/bin/env bash
# Badger fast check script
# Runs linting and type checking on changed files
# Arguments: list of changed file paths
# Exit 0 on success, non-zero on failure
set -euo pipefail

CHANGED_FILES=("$@")

echo "Running fast checks on ${#CHANGED_FILES[@]} file(s)..."

# TODO: Add your fast check commands here
# Examples:
#   npx eslint "${CHANGED_FILES[@]}"        # JS/TS linting
#   npx tsc --noEmit                         # TypeScript type checking
#   ruff check "${CHANGED_FILES[@]}"         # Python linting
#   mypy "${CHANGED_FILES[@]}"               # Python type checking

echo "Fast checks passed"
exit 0
```

**`scripts/check`** — Full test suite:

```bash
#!/usr/bin/env bash
# Badger full check script
# Runs the complete test suite
# No arguments
# Exit 0 on success, non-zero on failure
set -euo pipefail

echo "Running full checks..."

# TODO: Add your full check commands here
# Examples:
#   npx jest --ci                            # Jest tests
#   npx vitest run                           # Vitest tests
#   pytest                                   # Python tests
#   cargo test                               # Rust tests
#   go test ./...                            # Go tests

echo "All checks passed"
exit 0
```

**`scripts/release`** — Release script:

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
exit 0
```

After creating scripts, make them executable: `chmod +x scripts/check_fast scripts/check scripts/release`

### Notes

- If a `checksFast`, `checks`, or `release` entry uses `"type": "prompt"`, no script is needed. The `content` field contains the prompt text sent to the agent.
- Customize `failurePrompt` in the config to change what the agent is told when a check fails.
- Set any top-level key to `null` or omit it to disable that step (e.g., remove `release` to skip auto-release).