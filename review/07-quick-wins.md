# Quick wins

Two-hour pickups, ordered by leverage. Each links back to the finding
that motivates it.

## ≤ 30 minutes

1. **Add `events_project_kind_idx` migration.** (F-9) Two-line schema
   change + `pnpm db:generate`. Prevents the 100k-row cliff in retro
   mining queries.

2. **Bounds-check issue numbers in `parseDependencies`.** (F-2)
   Two lines. Stops bad bodies from looping the scheduler.

3. **Wrap `JSON.stringify` in `appendEvent`.** (F-4) Five lines.
   Removes a class of cascading crash.

4. **Log + swallow in leaf dispatch handlers.** (F-7, F-12) A pattern
   already partly applied — finish it: `dispatchTerminalLabel` and
   `withParallelLock` post-thunk should both catch and log.

5. **Quote `$RUN_ID` and check readability in hook scripts.** (F-13)
   Two scripts, four lines each.

6. **Drop or document `setMaxListeners(0)`.** (F-3) One line. Either
   remove and accept the warning at 11 subscribers, or add a comment
   citing the trade-off and a startup log of `listenerCount`.

7. **`replay({ kind })` should take `EventKind`, not `string`.** (F-28)
   Type-only change, catches typos.

## 30–90 minutes

8. **Atomic persona round-robin via SQL.** (F-1) Single `UPDATE … RETURNING`
   replaces three statements. Add a unit test with parallel callers in
   a single transaction.

9. **Index audit on hot tables.** (F-9 + scan): take `events`,
   `agent_run_costs`, `archived_lifecycles`, `decision_patterns`. Plot
   the EXPLAIN QUERY PLAN of each known caller. Add missing composites.
   90 min including the writeup.

10. **Default limit on `replay()`.** (F-10) Add `MAX_REPLAY = 50_000`,
    warn-and-truncate when exceeded. Update tests.

11. **Split `dispatchForLabel` into a table.** (F-17) Pure refactor,
    keep tests green. Improves readability + makes new states a
    one-liner.

12. **Cost-unknown event + warning when envelope missing.** (F-14) One
    new EventKind + an emit branch. Budget enforcement gets a real
    signal instead of silently undercounting.

13. **Cleanup hook for vitest temp DBs.** (F-26) Register `exit` +
    `SIGINT` handlers in `scripts/run-vitest-with-db.ts`.

## 90 minutes – half a day

14. **Cross-test the client + server dependency parsers.** (F-30) Add a
    fixture in `core/state-source/dependency-parser.fixtures.ts`, run
    the same expectation list through both implementations. Or
    eliminate the mirror by importing the core function from the web
    build.

15. **Pull subcomponents out of `ProjectModelPanel.tsx`.** (F-22)
    No behaviour change; just file hygiene. Ditto `BootstrapWizard.tsx`
    (F-23) and `grill-and-prd.ts` (F-24).

16. **`agent.json-parse-failed` event + better error.** (F-6) Plumb the
    runId-scoped event so `OutputValidationError` can include the
    raw-string preview in its message.

17. **Add READMEs for `target-projects/*`.** (F-29) Either real ones
    explaining each project's purpose, or update `docs/inventory.md`'s
    drift check to exempt target-project dirs.

## Pick of the day

If you only have an hour, do 1, 3, and 5. Two indexed queries, one
crash class, and two shell-quoting nits. Net effect: visibly cheaper
retros and a noticeably more robust event pipeline.

## Pick of the week

Add #8 (atomic persona selection) and #14 (parser cross-test). The
first removes a real correctness risk if anyone ever runs the CLI
against the same DB as the server. The second prevents a quiet UI
divergence the day the parser is touched.

## Don't bother

- Refactoring `core/agent-runtime/claude-cli.ts` for "readability."
  It's long because it has a lot of legitimate complexity (env, hooks,
  truncation, cost, two SQL writes). Surgical fixes only.
- "Replace EventEmitter with a real pub-sub library." No. Single-user
  local-first tool. The standard library is fine.
- Caching skill prompts or allowlists. Sub-millisecond reads. Save the
  budget for the indexes that actually matter.
