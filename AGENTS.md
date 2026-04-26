# AGENTS.md

## Runtime & Tooling

- **Package manager**: Use `bun` for all package operations (`bun install`, `bun add`, etc.)
- **Test runner**: Use `bun test --isolate` — not vitest, jest, or npm test
- **Script runner**: Use `bun run <script>` — not `npm run <script>`
- **Type checking**: Use `bunx tsc --noEmit` to check for TypeScript errors

## Commands

| Task | Command |
|------|---------|
| Install dependencies | `bun install` |
| Run tests | `bun test --isolate` |
| Type check | `bunx tsc --noEmit` |
| Dry run release | `bun run release:dry` |
| Release | `bun run release` |
| Session stats (all) | `bun scripts/session-stats.ts` |
| Session stats (latest) | `bun scripts/session-stats.ts --latest` |

## Git Workflow

The `main` branch is protected. **Never push directly to `main`.** Always create a feature branch and open a pull request.

### Branch naming

```
<type>/<short-description>-<model>
```

- `<type>`: conventional commit type (`feat`, `fix`, `refactor`, `chore`, etc.)
- `<short-description>`: brief hyphenated description
- `<model>`: the primary model that worked on the change (short name, e.g. `glm5`, `kimi`, `qwen`)

Examples:
- `feat/status-bar-timer-glm5`
- `fix/timer-leak-glm5`
- `chore/release-workflow-glm5`

### Creating a PR

```bash
# Create a feature branch
git checkout -b feat/status-bar-timer-glm5

# Make commits following conventional format, then:
git push -u origin feat/status-bar-timer-glm5

# Include session stats in the PR body:
bun scripts/session-stats.ts --latest

gh pr create --title "feat: show running time in status bar" --body "$(cat <<'EOF'
## Summary

<describe the change>

## Session cost

<paste output of bun scripts/session-stats.ts --latest here>
EOF
)"
```

### PR description template

Every PR should include:

1. **Summary** — what changed and why
2. **Session cost** — paste the output of `./scripts/session-stats.sh --latest` (or `./scripts/session-stats.sh` for all sessions). This shows models used, token counts, and cost.

### Updating a PR

```bash
git add ...
git commit -m "fix: address review feedback"
git push
```

### Merging

After CI passes and review is approved, merge via:

```bash
gh pr merge --squash --delete-branch
```

## Versioning & Releases

This project uses [Conventional Commits](https://www.conventionalcommits.org/) with [standard-version](https://github.com/conventional-changelog/standard-version) for automated versioning and changelog generation.

### How releases work

Releases happen **automatically on every merge to `main`**. The CI workflow (`.github/workflows/release.yml`):

1. Detects a push to `main` (i.e., a PR merge)
2. Runs tests
3. Runs `standard-version` to bump the version and update `CHANGELOG.md`
4. Pushes the version bump commit and git tag to `main`
5. Creates a GitHub Release with changelog notes

The version bump depends on the commit messages in the merged PR:

| Commit type | Version bump |
|-------------|--------------|
| `feat` | minor (0.x.0) |
| `fix`, `refactor`, `perf` | patch (0.0.x) |
| `feat!` or `BREAKING CHANGE` | major (x.0.0) |
| `docs`, `chore`, `test` | none |

### Commit message format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Examples:

```bash
git commit -m "feat: add fileFilter for routing changed files"
git commit -m "fix: resolve race condition in file watcher"
git commit -m "feat!: remove deprecated check type"
git commit -m "docs: update installation instructions"
```

### Setup: RELEASE_TOKEN

The workflow pushes version bump commits back to the protected `main` branch, which requires a Personal Access Token (PAT) with write access that can bypass branch protections.

To set this up:

1. Create a fine-grained PAT with **Contents: Read and write** permission for this repo
2. Grant the PAT's user/account "Bypass branch protections" permission in **Settings → Branch protection rules → main**
3. Add the PAT as a repository secret named **`RELEASE_TOKEN`** in **Settings → Secrets and variables → Actions**

If `RELEASE_TOKEN` is not set, the workflow falls back to `GITHUB_TOKEN`, which may fail if `main` is protected.

### Manual release (rare)

If you need to trigger a release manually (e.g., to pick up missed commits):

```bash
git checkout main
git pull
git checkout -b chore/release
bun run release
git push -u origin chore/release
gh pr create --title "chore: release v$(node -p "require('./package.json').version")" --body "Manual version bump and changelog update.\n\n## Session cost\n\n$(bun scripts/session-stats.ts --latest)"
# After merge, CI will handle tagging and GitHub Release
```

### Dry run

To preview what version bump and changelog will happen:

```bash
bun run release:dry
```

### Installation by version

Users can pin to a specific version:

```json
{
  "packages": ["git:github.com/garyjohnson/pi-badger#v0.2.0"]
}
```

Or get latest:

```json
{
  "packages": ["git:github.com/garyjohnson/pi-badger"]
}
```