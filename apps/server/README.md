# @goose-hub/server

API + SSE host for the Goose Hub web UI. Stands up the server process the UI talks to. Closes M2.01 (#26).

## Routes

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/projects` | lists projects from `target-projects/*/project.config.ts` |
| GET | `/projects/configs` | returns full `ProjectConfigDto[]` for all registered projects (used by Settings UI) |
| GET | `/projects/:slug/issues` | proxies `StateSource.listOpenWork()` |
| GET | `/projects/:slug/issues/:id` | proxies `StateSource.getItem()` |
| GET | `/projects/:slug/milestones` | proxies `StateSource.listMilestones()` |
| GET | `/projects/:slug/active-milestone` | reads `project_state.activeMilestoneNumber` (falls back to GitHub default) |
| POST | `/projects/:slug/active-milestone` | writes `project_state.activeMilestoneNumber`; emits `milestone.activated` |
| GET | `/projects/:slug/issues/:id/events` | replay of events for one item |
| POST | `/projects/:slug/issues/:id/transition` | validates against `isLegalTransition`, calls `StateSource.transitionState`, emits `state.transitioned` |
| GET | `/events` | SSE event stream with `Last-Event-ID` resumption (header or `?lastEventId=` query); filters: `projectId`, `workItemId` |

## Event stream contract

Events flow through a single chokepoint, `core/event-stream/store.ts` `appendEvent()`. SQLite write is durable before subscribers are notified. No part of the codebase should write to the `events` table directly.

## Run

```sh
GITHUB_TOKEN=ghp_… pnpm --filter @goose-hub/server dev
curl -N http://localhost:3001/events?projectId=goose-hub-self
```

## Conventions

See [`STANDARDS.md`](./STANDARDS.md) for the domain-module architecture, layer contracts, import rules, and test coverage requirements. Read it before touching any file in `src/`.

## Slice notes

- ADR `docs/adr/0006-server-framework-hono.md` records the framework choice (Hono).
- `apps/server` itself contains no slice-test (the surface tests live alongside the chokepoints in `core/event-stream/store.test.ts` and `core/state-source/github-labels.test.ts`).
