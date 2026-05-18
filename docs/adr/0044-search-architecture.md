# ADR 0044: Cross-project search architecture

- Status: Accepted
- Date: 2026-05-18

## Context

Goose Hub needed a single entry point for finding work items and agent
decisions across every registered project. The placeholder
"Search — available later" button in `TopBar` had been sitting unwired
since M2.

Three options on the table:

1. **SQLite FTS5** virtual table over a synced shadow of work items.
2. **Fuse.js** (or similar) for typo-tolerant fuzzy matching.
3. **Hand-rolled BM25-lite** in pure TypeScript with an explicit
   `scoreItem` function.

## Decision

Ship hand-rolled BM25-lite (option 3) as the v0 ranker.

**Why this and not the others:**

- **Corpus size.** Even the largest registered project today is in the
  low hundreds of open issues. SQLite FTS5 is built for "ten thousand
  to ten million" — using it now would pay for an index sync path,
  schema migration, and tokenizer config it doesn't earn back. The
  whole point of FTS5 is to avoid `O(N)` scans; with `N` in the
  hundreds, the scan is free.
- **Iteration speed.** The ranker will get tweaked: title-vs-body
  weights, recency boost shape, `#234` direct hits, milestone
  weighting, eventually field-specific stopword lists. Each of those
  is a one-line change with a unit test in `score.test.ts`. The same
  change inside an FTS5 virtual table is a rebuild + tokenizer
  reconfig.
- **No new dependencies.** FACTORY_RULES rule 27 prohibits heavyweight
  deps without an ADR. Fuse.js would qualify; BM25-lite is one TS
  file.

## Architecture

```
apps/server/src/domains/search/
├── router.ts        Hono GET /search?q=&limit=&projectSlug=&type=&milestone=&includeClosed=
├── service.ts       fan-out → score → rank → paginate
├── score.ts         pure: parseQuery, scoreItem, scoreEventText, normalizeConfidence
└── cache.ts         60s TTL memo per (slug, kind, milestoneNumber)
```

`service.search()` returns a unified `SearchResult` with two banks:

```ts
{
  items: SearchHit[];        // work items
  events: EventHit[];        // matching agent.decision-summary events
  total: number;             // total work-item hits before slicing
  totalEvents: number;       // total event hits before slicing
  hasMore: boolean;          // work-item page exhausted?
}
```

Both banks normalise confidence independently — the top work-item hit
reads `100` regardless of what events scored.

### Scoring

Work items:

```
score = (title × 3 + milestone × 1.5 + body × 1) × (1 + recencyBoost)
recencyBoost: up to +10% for items inside a 30-day window, linearly decaying
```

`#234` (or just `234`) is parsed by `parseQuery` as an `externalId`
direct hit and gets a fixed score of `1000`, swamping everything else.

Events: same recency-boost shape, single text weight (token = 30). The
text field is `payload.summary` on `agent.decision-summary` events
(per CONTEXT.md's two-stream decision-summary design).

### Caching

Each request fans out to every registered project's source
(`listOpenWork`, optionally `listClosedWorkByMilestone`). For
single-project setups that's one GitHub API hit; for multi-project
the cost is `O(P)`. `cache.ts` adds a 60s TTL memo keyed by
`(slug, 'open'|'closed', milestoneNumber)` so bursty typing doesn't
re-hit GitHub on every keystroke.

The cache is process-lifetime, in-memory. No invalidation hooks — 60s
is short enough that staleness is bounded; we accept that a typed-in
work item won't appear in search for up to 60 seconds.

### Holdout discipline

The search endpoint reads cached, post-redaction event payloads
through `eventStore.replay` — the same path retrospectives use. It
does NOT touch raw decision-summary text from agent runs. Search is a
post-emission consumer, not an emission point, so it inherits the
secret-redaction already done by `appendEvent`.

## Path forward

The day `scoreItem` is too slow or too dumb, it gets swapped behind
the same interface — `service.search()` doesn't care how scores get
produced. Likely path:

1. Add a Drizzle-backed `work_item_search` FTS5 table populated by the
   webhook handler.
2. Replace the `cachedListOpenWork → in-memory score` loop with an FTS5
   `MATCH` query that produces a `WorkItem[]` already sorted.
3. Keep `score.ts` as the test-bed for weight tweaks until parity is
   confirmed, then either delete it or repurpose its weights into FTS5
   `bm25(...)` column weights.

No commitments today; recorded so the next agent knows the seam exists.

## Out of scope (filed as follow-ups under #834)

- Searchable surfaces beyond work items + decision-summary events
  (inbox, milestones, projects, comments, other event kinds).
- Semantic / embedding-based ranking (would need rule 27 escalation
  for the embedding service dep).
- `Include closed` while Milestone is `all` (would require iterating
  every milestone per project — replace the cache fan-out with a
  precomputed `closed_items` shadow table or accept the cost).
