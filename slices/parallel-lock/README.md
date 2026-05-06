# slices/parallel-lock

Multi-parallel project lock relaxation. Closes M11.08 (#294).

## What it does

FACTORY_RULES rule 4 previously enforced one active workflow per project at a
time. M11.08 relaxes this to allow up to `maxParallelAgents` concurrent
workflows on **distinct** issues within the same project. The per-issue
uniqueness guarantee is preserved — two workflows on the same issue are never
allowed.

## Vertical surfaces touched

- **Core lib**: `core/projects/parallel-lock.ts`
  - `ProjectParallelLock` class — tracks in-flight issue slots per project slug
  - `parallelLock` singleton — shared across the server process
  - `tryAcquire(slug, issueNumber, maxParallelAgents)` — returns `true` iff a
    slot is available and not already held by this issue
  - `release(slug, issueNumber)` — frees the slot when the workflow completes
  - `inFlightCount(slug)` — returns current occupancy (used in log context)
  - `isInFlight(slug, issueNumber)` — read-only check (used by `dispatchResumeIssue`)

- **Server shared**: `apps/server/src/shared/dispatch.ts`
  - Replaced `_issueInFlight: Set<string>` (flat per-issue guard) with the
    `parallelLock` singleton
  - Every `dispatchXxx` function now calls `parallelLock.tryAcquire` (with
    `maxParallelAgents` from project config) before starting work, and
    `parallelLock.release` in the `finally` block
  - `getMaxParallelAgents(slug)` helper looks up `budgets.maxParallelAgents`
    from the project config (defaults to 1 for backward compatibility)

## Lock semantics

| Condition | Result |
|-----------|--------|
| Issue not in-flight AND project has free slots | `tryAcquire → true` |
| Same issue already has a workflow running | `tryAcquire → false` (per-issue lock) |
| Project has reached `maxParallelAgents` | `tryAcquire → false` (cap) |

Budget cap enforcement (per-workflow USD check) happens inside each workflow via
`resolveBudgets()` — it is not bypassed by the parallel dispatch path.

## Configuration

`maxParallelAgents` lives in `ProjectConfig.budgets.maxParallelAgents` (already
present in `core/types.ts`). Set it to `1` (default) for the original
single-workflow-per-project behaviour, or `2+` to enable parallel dispatch.

The `goose-hub-self` project config already declares `maxParallelAgents: 3`.

## Running the tests

```bash
pnpm test slices/parallel-lock/slice.test.ts
pnpm test core/projects/parallel-lock.test.ts
```

No live GitHub API required — all tests use the `ProjectParallelLock` class
directly.
