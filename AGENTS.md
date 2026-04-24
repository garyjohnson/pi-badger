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