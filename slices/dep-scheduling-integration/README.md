# slices/dep-scheduling-integration

M11.10: Integration tests for dependency-aware scheduling (#301).

## What this slice tests

End-to-end wiring of the full dependency-scheduling stack:

```
createProjectAwareTargetSource
  → DependencyResolver
    → filterEligibleByDependencies
      → ProjectParallelLock
```

Each test exercises a cross-component interaction that individual unit tests in
`slices/dependency-scheduler/`, `slices/move-with-deps/`, and
`slices/parallel-lock/` cannot cover in isolation.

## Scenarios covered

| # | Scenario | Key assertion |
|---|----------|---------------|
| 1 | Same-repo dep: B open → A blocked; B closes → A eligible | Two-tick state transition via `createProjectAwareTargetSource` |
| 2 | Cross-repo registered dep: open then closed | `createProjectAwareTargetSource` routes to the correct project fetcher |
| 3 | Unregistered cross-repo dep | `needs-human` forced + comment posted; no re-escalation on repeat ticks |
| 4a | `moveIssueToCurrent --with-dependencies` | All open deps moved; closed deps skipped |
| 4b | `moveIssueToCurrent --ignore-dependencies` | Item moved; scheduler immediately re-blocks on open dep |
| 5a | `maxParallelAgents=2`, two eligible issues | Both acquire parallel-lock slots |
| 5b | `maxParallelAgents=2`, three eligible issues | Two dispatched; third deferred until a slot frees |
| 5c | Parallel cap does not bleed across projects | Independent project caps |
| 6 | Live GitHub API smoke (GITHUB_TOKEN guarded) | Real `defaultFetchTargetForProject` resolves a known closed issue |

## Distinction from unit tests

- These tests go through **`createProjectAwareTargetSource`** (the project-registry
  wiring layer), not raw `FetchTargetFn` mocks.
- The two-tick scenarios verify the state-transition contract across calls to
  `filterEligibleByDependencies`, which each create a fresh `DependencyResolver`.
- The parallel tests combine dep-filter output with `ProjectParallelLock`
  acquisition, matching what `apps/server/src/shared/dispatch.ts` does at runtime.

## Running the tests

```bash
# All dep-scheduling integration tests
pnpm vitest run slices/dep-scheduling-integration/slice.test.ts

# Include live GitHub API smoke (requires GITHUB_TOKEN)
GITHUB_TOKEN=ghp_... pnpm vitest run slices/dep-scheduling-integration/slice.test.ts
```

## Surfaces touched

This slice adds no new implementation — it exercises:
- `core/projects/dependency-scheduler.ts` (`filterEligibleByDependencies`)
- `core/projects/parallel-lock.ts` (`ProjectParallelLock`)
- `core/projects/move-with-deps.ts` (`moveIssueToCurrent`)
- `core/state-source/dependency-resolver.ts` (`createProjectAwareTargetSource`)
