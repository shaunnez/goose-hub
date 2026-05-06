## Test commands


| What | Command |
|---|---|
| All packages | `pnpm test --reporter=json` |
| Specific file | `pnpm test --reporter=json <relative-path>` |

`<relative-path>` is **relative to the package root** (`apps/web/`), not the worktree root. Example:

```
pnpm test --reporter=json src/components/detail/components/TimelineExpandCollapse.test.tsx
```

**First command in any worktree:** `cat package.json` to verify available scripts.

**Shell syntax is forbidden:** `2>&1`, `&&`, `;`, `|` are literal arguments with `shell: false` — they break the command. CWD is always worktree root, immutable between calls. Same command = same result, always. If a command fails, diagnose — do not retry.

**Reading JSON test output:** check `numFailedTests` first — if `0`, suite is green. If `> 0`, read `testResults[].assertionResults[]` where `status === "failed"` for error detail. If `testRun` is injected in context, use it directly — do not re-run.

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
