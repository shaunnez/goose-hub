## Monorepo test commands

Run from worktree **root** using pnpm filter syntax — NOT from `apps/web/`:

| What | Command |
|---|---|
| All packages | `pnpm test -- --reporter=json` |
| Web only | `pnpm --filter=@goose-hub/web test -- --reporter=json` |
| Server only | `pnpm --filter=@goose-hub/server test -- --reporter=json` |
| Specific file | `pnpm --filter=@goose-hub/web test -- --reporter=json <relative-path>` |

`<relative-path>` is **relative to the package root** (`apps/web/`), not the worktree root. Example:

```
pnpm --filter=@goose-hub/web test -- --reporter=json src/components/detail/components/TimelineExpandCollapse.test.tsx
```

Not `apps/web/src/...`. Not a glob. Just `src/...`.
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

## Evidence specs (e2e)

Evidence specs are **visual proof the feature exists in the running app**, not a second unit test. Unit tests cover logic; evidence specs confirm the feature renders and responds in the browser.

**Do not rely on live data.** The Factory workspace has an empty SQLite DB (no synced events) and GitHub API calls are flaky under rate limits. A spec that navigates to the board and checks for issue links will find nothing and exit early — the feature is never exercised.

**Use `page.route()` to mock API responses** whenever the feature requires data to render:

```typescript
// Intercept the endpoint and return minimal fixture data
await page.route('**/api/issues/*/timeline*', route =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ id: '1', type: 'agent.run', /* ...required fields */ }]),
  })
);
await page.goto('/issues/511');
// now assert the feature — buttons, panels, etc.
```

To find the right endpoint and response shape: read the component file, grep its `fetch`/`useQuery` calls, then read the server router for the matching route and its response type.

**Graceful-exit guards are wrong for evidence specs.** `if (!hasData) return;` means the spec never tests the feature. Skip the guard — mock the data instead so the feature always renders.
