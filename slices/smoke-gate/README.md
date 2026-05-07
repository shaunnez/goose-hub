# slices/smoke-gate

Non-skippable smoke gate for every workflow tick. Closes M11.17 (#555).

## What it does

`core/orchestrator/smoke.ts` exports `runSmoke(config)` — a pre-dispatch
infrastructure check that runs before every workflow tick. If any check fails,
the dispatcher must halt dispatch for that project (other projects continue).

### Checks (in order)

| # | Check | Command |
|---|-------|---------|
| 1 | GitHub CLI auth | `gh auth status` |
| 2 | Workspace git integrity | `git fsck --no-progress --connectivity-only` |
| 3 | Claude binary resolves (rule 30) | `claude --version` |
| 4 | SQLite ping | `SELECT 1` via Drizzle |
| 5 | API key present | `process.env.ANTHROPIC_API_KEY` non-empty |
| 6 | Budget floor | `perWorkflowMaxUsd > $0.50` (default floor) |

On failure, `runSmoke` emits a `workflow.smoke-failed` event (carrying the
failing check name + redacted stderr) and returns `{ ok: false, failedCheck, reason }`.

Result is **cached 60 seconds per project slug** — smoke does not re-run on
every tick. Call `clearSmokeCache(slug)` to evict (used in tests).

### Non-skippable

No env override or flag bypasses the gate. If you need to bypass in a test, use
`clearSmokeCache` + mock the side effects rather than adding a skip flag.

## Vertical surfaces touched

- **`core/orchestrator/smoke.ts`** — `runSmoke(config)`, `clearSmokeCache(slug)`
- **`core/event-stream/store.ts`** — added `'workflow.smoke-failed'` to `EventKind`

## Running the tests

```bash
pnpm test slices/smoke-gate/slice.test.ts
```

All tests use mocked `execSync`, `db`, and `eventStore` — no live GitHub API,
no live Claude binary, no real SQLite required.
