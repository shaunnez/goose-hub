# slices/dependency-scheduler

Scheduler dependency-satisfaction filter. Closes M11.03 (#292).

## What it does

Before a work item is dispatched, the scheduler evaluates all `Depends on` /
`Blocks` / `Blocked by` references in its body. Items with unsatisfied deps are
skipped for the current tick and labelled `schedule:blocked-by`. When deps close
in a later tick, the label is restored to `schedule:current` and the item is
re-admitted to the eligible queue.

## Vertical surfaces touched

- **Core lib**: `core/projects/dependency-scheduler.ts`
  - `evaluateDependencies(item, resolver)` — classifies one item as
    `satisfied | blocked | unregistered`
  - `filterEligibleByDependencies(items, ctx)` — filters a list; applies /
    removes `schedule:blocked-by` labels as side-effects; returns
    `{ eligible, blocked, unregistered }` partitions

Dependencies are parsed via `core/state-source/dependency-parser.ts`
(`parseDependencies`) and resolved via `core/state-source/dependency-resolver.ts`
(`DependencyResolver`). A fresh resolver is constructed per call so results are
never cached across ticks.

## Classification rules

| Condition | Result |
|-----------|--------|
| Zero deps | `satisfied` |
| All deps closed | `satisfied` |
| Any dep `open` (no unregistered) | `blocked` → `schedule:blocked-by` |
| Any dep `unregistered` | `unregistered` → skip (M11.07 escalates) |

Unregistered deps take precedence over open deps. A `factory:needs-human` label
is **not** applied here — that is M11.07's responsibility.

## Label lifecycle

`schedule:blocked-by` is set by the orchestrator (not just a human override).
When all deps close, the next tick restores `schedule:current`. Items already
carrying `schedule:blocked-by` are not re-labelled on repeat ticks.

## Running the tests

```bash
pnpm test slices/dependency-scheduler/slice.test.ts
pnpm test core/projects/dependency-scheduler.test.ts
```

No live GitHub API required — all tests use injected fetch-target fakes.
