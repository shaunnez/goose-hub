# Performance notes

The system is local-first, single-user, and event-driven. Most of it
doesn't need optimisation. This is the short list of places that
**will** matter once the event log grows past ~100k rows.

## Hot paths today

| Path | Frequency | Cost shape |
|---|---|---|
| `eventStore.appendEvent()` | Every event (~10s of events per agent run, dozens of runs/day) | One SQLite insert + N synchronous subscriber calls. ~1ms. Cheap. |
| `eventStore.replay()` | Every SSE connection, every resume, every retro mining | One indexed SELECT. Cheap for now; see below. |
| `invokeSkill()` | Once per agent invocation | Bound by the child process. The SQL inside is <5ms. |
| `runSmoke()` | Every project tick (cached 60s) | Five child processes when uncached; near-free when cached. |
| Per-project tick | Configurable (`tickIntervalSeconds`, default 60s) | One `gh issue list` + dependency resolution per tick. GitHub API rate is the bottleneck, not SQL. |
| Web Kanban | One initial REST + one SSE per route mount | React Query caches; cleanup hooks fire correctly. |

## Where indexes will start to bite

The `events` table is the only one that grows monotonically. At
~100k rows the missing `(project_id, kind, id)` index becomes a
noticeable cliff for these queries:

- Cross-run retro: `WHERE project_id = ? AND kind IN ('qa.completed', 'review.completed', 'retrospective.completed')`
- Sprint-review trigger: `WHERE project_id = ? AND kind = 'state.transitioned' AND created_at > ?`
- Dispatch resume: `WHERE project_id = ? AND work_item_id = ?` (already indexed; fine)

**Recommendation.** Add `events_project_kind_idx ON events(project_id, kind, id)`
in a new migration. Cheap; you'll be glad later. (Finding F-9.)

## Caches that exist and work

- **Smoke gate**, per-slug, 60s TTL. Result cached on success only; failures
  re-checked next tick.
- **React Query**, default 5-minute stale time except Board which uses
  `gcTime: 0` (live).
- **Project config**, loaded once on server start. Reloaded only when the
  Settings page "Reload" button is clicked.

## Caches I would NOT add

- **`getItem` / `replaceFactoryStateAtomic`** — these are GitHub
  round-trips. Caching them invites the TOCTOU class of bugs we already
  see in F-11. Pay the network cost; it's <200ms.
- **Skill config / prompt** — `readPromptWithContext()` reads three small
  files. Sub-millisecond.
- **Event payload JSON parse** — `JSON.parse` on a few-KB string is
  ~10µs. Don't cache.

## Caches I'd consider

- **`computeAllowlist(spec)`** in `core/tool-layer/allowlist.ts`. The
  result depends only on `(role, toolBundles)` which are static per
  skill. Memoising by stringified key would save a few ms per spawn —
  trivially small but reduces a hot read of `skills/<name>/skill.config.ts`.
  Probably not worth it; mention because it's the obvious next step
  someone might try.
- **`loadProjects()`** is already once-on-boot. If the project count
  ever grows past ~50, the linear scan in `getProjectBySlug()` could
  become a map lookup.

## Long-running concerns

- **`agent_run_costs` and `events` are append-only.** No retention.
  After ~6 months of daily use on a busy project this DB gets sizable
  (rough order: 1-10 GB). Two options when it matters:
  1. Periodic archive to a sidecar DB (`factory-archive-<year-month>.db`).
  2. SQLite `VACUUM INTO` for compaction; not necessary as long as WAL
     is checkpointing.
- **`archived_lifecycles`** stores JSON blobs. If lifecycles get big
  (decision summaries + learning entries), this can be a per-row cost.
  Today it's fine.

## Concurrency cliffs

- **Per-project parallel-agents cap defaults to 1.** Raising it (project
  config `budgets.maxParallelAgents`) means multiple `claude` child
  processes running at once. Each child can use ~1-2 GB resident; check
  RAM before raising past 3-4. The lock module enforces the cap correctly
  (`core/projects/parallel-lock.ts:32`).
- **Per-issue scout fan-out (`maxScoutAgents`, default 6).** Multiplied
  by `maxParallelAgents` this can be 6 × N children at once.
  Worth a comment in `project.config.ts` examples.

## SSE specifics

The SSE channel does the right things:

- `buildSseStream` replays since `Last-Event-ID` then tails.
- 15s heartbeat keeps proxies happy.
- One `EventSource` per page mount, cleanup in effect return.

No issues. The thing to watch is the **number of concurrent SSE
clients**: each adds an EventEmitter subscriber (F-3). A single-user
tool will have 1-3 tabs open; not a problem unless someone opens
hundreds.

## What to leave alone

- Drizzle ORM call sites. The query shapes are fine.
- React rendering (the components are small and React 19 handles the
  rest).
- The Hono server. Hono is fast; nothing in the route handlers blocks.
- Better-sqlite3 sync calls. The whole event-log story depends on them.
  Switching to an async client would break the single-writer guarantee.
