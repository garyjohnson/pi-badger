# AGENTS.md

## Runtime & Tooling

- **Package manager**: Use `bun` for all package operations (`bun install`, `bun add`, etc.)
- **Test runner**: Use `bun test` — not vitest, jest, or npm test
- **Script runner**: Use `bun run <script>` — not `npm run <script>`
- **Type checking**: Use `bunx tsc --noEmit` to check for TypeScript errors

## Commands

| Task | Command |
|------|---------|
| Install dependencies | `bun install` |
| Run tests | `bun test` |
| Type check | `bunx tsc --noEmit` |
| Dry run release | `bun run release:dry` |
| Release | `bun run release` |

## Versioning

This project uses [Conventional Commits](https://www.conventionalcommits.org/) with [standard-version](https://github.com/conventional-changelog/standard-version) for automated versioning and changelog generation.

### Commit Message Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type | Version Bump | Description |
|------|--------------|-------------|
| `feat` | minor (0.x.0) | New feature |
| `fix` | patch (0.0.x) | Bug fix |
| `refactor` | patch | Code refactoring |
| `perf` | patch | Performance improvement |
| `docs` | none | Documentation only |
| `chore` | none | Maintenance |
| `test` | none | Tests |

### Breaking Changes

Append `!` to the type to introduce a breaking change:

```
feat!: change API surface
```

This triggers a major version bump (x.0.0).

### Examples

```bash
# New feature
git commit -m "feat: add fileFilter for routing changed files"

# Bug fix
git commit -m "fix: resolve race condition in file watcher"

# Breaking change
git commit -m "feat!: remove deprecated check type"

# Docs only
git commit -m "docs: update installation instructions"
```

### Release Workflow

#### Manual Release

1. **Make commits** following the conventional format
2. **Dry run** to see what version bump will happen:
   ```bash
   bun run release:dry
   ```
3. **Release** to bump version, update CHANGELOG, and create git tag:
   ```bash
   bun run release
   ```
4. **Push** to remote:
   ```bash
   git push && git push --tags
   ```

#### Automated Release (CI)

The project includes a GitHub Actions workflow (`.github/workflows/release.yml`) that:
- Triggers on push to `main`
- Runs tests
- Automatically bumps version using `standard-version`
- Updates CHANGELOG.md
- Creates and pushes git tags

When you merge a PR to main, the action runs and bumps the version automatically. Users can pin to any tag (e.g., `#v0.2.0`) or use the latest by not specifying a version.

### Version Bump Rules

- `feat` → 0.x.0 (minor)
- `fix`, `refactor`, `perf` → 0.0.x (patch)
- `feat!`, `BREAKING CHANGE` → x.0.0 (major)
- `docs`, `chore`, `test` → no bump

### Installation by Version

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