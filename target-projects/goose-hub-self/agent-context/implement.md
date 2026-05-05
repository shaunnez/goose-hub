## Monorepo test commands

Run from worktree **root** using pnpm filter syntax — NOT from `apps/web/`:

| What | Command |
|---|---|
| All packages | `pnpm test -- --reporter=json` |
| Web only | `pnpm --filter=@goose-hub/web test -- --reporter=json` |
| Server only | `pnpm --filter=@goose-hub/server test -- --reporter=json` |
| Specific file | `pnpm --filter=@goose-hub/web test -- --reporter=json <relative-path>` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |

**First command in any worktree:** `cat package.json` to verify available scripts.

**Shell syntax is forbidden:** `2>&1`, `&&`, `;`, `|` are literal arguments with `shell: false` — they break the command. CWD is always worktree root, immutable between calls. Same command = same result, always. If a command fails, diagnose — do not retry.

**Reading JSON test output:** check `numFailedTests` first — if `0`, suite is green, stop. If `> 0`, read `testResults[].assertionResults[]` where `status === "failed"` for full error detail and stack traces.

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
- localStorage state: use `localStorage.setItem(...)` in `beforeEach`, NOT `vi.spyOn(Storage.prototype, 'getItem')` — jsdom provides real localStorage; spyOn only intercepts `getItem` while `setItem` still hits real storage, so reads and writes diverge
- Before mocking any hook: read the component file and grep its imports first (discipline rule 5)
- `MemoryRouter` is required for any component that uses `Link` or `useNavigate`
- **Before any test rewrite:** re-read the component and grep for the exact key/state it reads (e.g. `localStorage.getItem`, `useState`, `useRef`). A test that doesn't mirror the component's actual state access will fail regardless of rewrites.
