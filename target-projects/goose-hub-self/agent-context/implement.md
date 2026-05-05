## Monorepo test commands

Run from worktree **root** using pnpm filter syntax — NOT from `apps/web/`:

| What | Command |
|---|---|
| All packages | `pnpm test` |
| Web only | `pnpm --filter=@goose-hub/web test -- --reporter=verbose` |
| Server only | `pnpm --filter=@goose-hub/server test -- --reporter=verbose` |
| Specific file | `pnpm --filter=@goose-hub/web test -- --reporter=verbose <relative-path>` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |

**First command in any worktree:** `cat package.json` to verify available scripts.

## Before touching any app

- Touching `apps/web/` → read `apps/web/README.md` first
- Touching `apps/server/` → read `apps/server/README.md` first

## Slice structure requirements

Every new slice at `slices/<name>/` MUST include:
- `slice.test.ts` — integration tests (required, not optional)
- `README.md` — purpose, usage, context allowlist

## Import discipline

- Slices import from `core/` using `@goose-hub/core/...` paths only
- Slices NEVER import from other slices
- Never use relative `../../core/...` paths

## Web component test patterns

- jsdom environment: add `/** @vitest-environment jsdom */` at top of test file
- localStorage state: use `localStorage.setItem(...)` in `beforeEach`, NOT `vi.spyOn(Storage.prototype, 'getItem')`
- Before mocking any hook: read the component file and grep its imports first (discipline rule 5)
- `MemoryRouter` is required for any component that uses `Link` or `useNavigate`
