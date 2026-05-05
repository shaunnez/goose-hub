# core/projects

Project registration loader for Goose Hub's multi-project orchestration.

## API

### `loadProjects(projectsRoot?)`

Reads every `target-projects/*/project.config.ts` and returns `ProjectConfig[]`. Missing or malformed configs are skipped with a warning; startup is not aborted. Throws `DuplicateSlugError` if two projects share the same slug.

```ts
import { loadProjects } from '@goose-hub/core/projects/loader.js';

const projects = await loadProjects(); // defaults to repo-root/target-projects
```

### `getProjectBySlug(slug, projectsRoot?)`

Loads a single project config by slug. Returns `null` if the directory or config file is absent.

### `detectDuplicateSlugs(configs)`

Pure function — throws `DuplicateSlugError` on first duplicate slug. Exported for isolated testing.

### `DuplicateSlugError`

Thrown when two projects share a slug. Carries `.slug: string`.

## Scheduler

### `startPerProjectScheduler(projects, tickFn)`

Starts one independent `setInterval` per project. Each fires at `project.tickIntervalSeconds ?? 60` seconds. Errors in one project's tick are caught and logged; they never prevent other projects' timers from firing. Returns a `ProjectScheduler` handle with a `stop()` method.

```ts
import { loadProjects } from '@goose-hub/core/projects/loader.js';
import { startPerProjectScheduler } from '@goose-hub/core/projects/scheduler.js';

const projects = await loadProjects();
const scheduler = startPerProjectScheduler(projects, async (slug) => {
  await runTriageBatch(slug);
});
// later: scheduler.stop()
```

Per-project locking (one workflow at a time) is enforced in `apps/server/src/shared/dispatch.ts` via per-slug in-flight sets — not in the scheduler itself.

## Adding a project

Create `target-projects/<slug>/project.config.ts` exporting a `ProjectConfig` default. Required fields added in M10:

- `colorStripe: string` — hex color for the project's UI stripe (e.g. `'#7c3aed'`)
- `activeMilestone?: string` — GitHub milestone title currently being worked (e.g. `'M10: Multi-project Orchestration'`)

## Caching

Configs are cached by directory path after first load. The server must restart to pick up config file changes (no hot-reload).
