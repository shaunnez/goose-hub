## Test commands

| What | Command |
|---|---|
| Full suite | `pnpm test` |
| Web only | `pnpm --filter=@goose-hub/web test -- --reporter=verbose` |
| Server only | `pnpm --filter=@goose-hub/server test -- --reporter=verbose` |
| E2E | `pnpm test:e2e` (only run if `e2eCommand` is provided) |

## Known noise — do not report as findings

- `ERR_DLOPEN_FAILED` on `better-sqlite3` — native module not rebuilt for worktree Node version. Pre-existing environment issue, not a regression introduced by the PR.
- If ALL failures are sqlite noise: mark functional tier `passed`, add one `info`-severity finding noting the sqlite environment noise.

## Slice structure (blocker if absent)

New slices at `slices/<name>/` MUST contain both:
- `slice.test.ts`
- `README.md`

Flag absence of either as a `blocker` finding.

## Cross-slice imports (blocker)

Relative imports between slices (`../other-slice/...`) are forbidden. Flag as `blocker`.

## Import paths

Correct: `@goose-hub/core/...`
Wrong: `../../core/...`

Flag wrong paths as `major` findings.
