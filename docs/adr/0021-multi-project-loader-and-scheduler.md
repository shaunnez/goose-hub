# ADR 0021: Multi-project Loader and Per-project Scheduler in `core/projects/`

**Status:** Accepted
**Date:** 2026-05-05 (renumbered 2026-05-06)
**Milestone:** M10 — Multi-project Orchestration

> Originally filed as ADR 0018, which collided with `0018-decision-kind-taxonomy.md`. Renumbered to 0021 in the M11 governance refresh; content unchanged.

## Context

M10 makes Goose Hub capable of driving more than one target project simultaneously. Two new runtime concerns emerged:

1. **Project discovery** — at startup, enumerate every `target-projects/*/project.config.ts` and return typed `ProjectConfig[]`. Callers include the tick scheduler, the HTTP projects endpoint, the budget checker, and the CLI `status` command.

2. **Per-project tick scheduling** — each registered project needs an independent orchestrator tick loop. A crash or long-running workflow in project A must not delay project B's tick.

PLAN §6 had sketched these responsibilities under a `core/orchestrator/` directory (with `tick.ts`, `locks.ts`, `scheduler.ts`). That directory was never built: the dispatch/lock logic landed in `apps/server/src/shared/dispatch.ts` and the actual tick driver lived in `apps/server/src/index.ts`. The "orchestrator" concept fragmented across server-layer concerns, leaving no appropriate home in `core/`.

## Decision

### 1. `core/projects/` as the new module

A new `core/projects/` module holds two files:

- **`loader.ts`** — `loadProjects()` and `getProjectBySlug()`. Reads all `target-projects/*/project.config.ts` files at startup. Design choices:
  - Uses `import()` (dynamic) to load each TypeScript config via `tsx`/`ts-node` resolution at runtime.
  - Process-lifetime in-memory cache per directory path — configs don't change while the server is running; hot-reload is not required (restart is sufficient, per M10 scope).
  - Missing or malformed configs log a warning and are skipped; startup is not aborted.
  - Duplicate slug detection throws `DuplicateSlugError` eagerly, preventing silent misconfiguration.
  - `DEFAULT_PROJECTS_ROOT` is resolved relative to the compiled module's `__dirname` so the loader works regardless of the working directory the server is launched from.

- **`scheduler.ts`** — `startPerProjectScheduler()`. Spawns one `setInterval` per project. Design choices:
  - Error isolation: each tick call is wrapped in `.catch()`; a throw in project A's tick never cancels project B's timer.
  - Interval is per-project configurable via `ProjectConfig.tickIntervalSeconds` (default 60 s).
  - Returns a `ProjectScheduler` handle with a `stop()` method for clean shutdown and test teardown.
  - Per-project *locking* is intentionally not in the scheduler — it stays in `apps/server/src/shared/dispatch.ts` per-slug in-flight sets. The scheduler only drives timing; dispatch handles concurrency.

### 2. `core/orchestrator/` is not built

The previously planned `core/orchestrator/` (with `tick.ts`, `locks.ts`, `scheduler.ts`) was never built. PLAN §6 is updated to remove it and replace it with `core/projects/`. The responsibilities are:

| Concern | Actual home |
|---|---|
| Per-project tick timing | `core/projects/scheduler.ts` |
| Per-project locking | `apps/server/src/shared/dispatch.ts` (per-slug in-flight Set) |
| Workflow dispatch | `apps/server/src/shared/dispatch.ts` |
| Project config access | `apps/server/src/shared/projects.ts` (thin wrapper over `core/projects/loader.ts`) |

### 3. Why `core/` and not `apps/server/src/shared/`

`loadProjects()` is consumed by the CLI (`goose status` reads config to format output) as well as the server. Putting it in `apps/server/src/shared/` would require the CLI to import from the server package, violating the workspace boundary. `core/` is the shared layer both apps import from.

`startPerProjectScheduler()` is only called from `apps/server/src/index.ts`, but placing it in `core/` keeps the scheduler logic independently testable without importing the Hono server stack.

## Consequences

- `apps/server/src/shared/projects.ts` becomes a thin delegation wrapper — `listProjects()` calls `loadProjects()`, `getProject()` calls `getProjectBySlug()`. No business logic lives there.
- Adding a new project is a file-system operation (`target-projects/<slug>/project.config.ts`), not a code change. The loader discovers it on next restart.
- The M10 exit criterion (two independent lifecycles) is enabled: each project gets its own tick interval and its budget/lock state is keyed by slug throughout the server.
- M12 (project bootstrap workflow) will extend this by writing new `project.config.ts` files programmatically, but the loader shape does not change.
