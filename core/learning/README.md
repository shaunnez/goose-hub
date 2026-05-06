# core/learning

Cross-session learning loop: archive, pattern mining, and convergence detection for the retrospective workflow.

## Purpose

After each work item completes (transition to `factory:done`), the retrospective archives lifecycle data (decision summaries, learning entries, quality scores, costs). This module provides:

1. **archiveLifecycle** — extracts and aggregates per-item data from the event stream
2. **minePatterns** — groups decision summaries by (kind, role), computes consistency scores
3. **computeTrend** — detects quality score trends (improving/stable/declining) across a sliding window

The archived data feeds the cross-merge retro (M11.12) and skill-coach (M11.13).

## Exports

### archiveLifecycle({ projectId, workItemId })

Called by `core/workflows/retrospective.ts` on state transition to `factory:done`.

Reads the event stream and writes one row to `archived_lifecycles` with:
- `decisionSummaries` — deduped decision events
- `learningEntries` — from retrospective.completed events
- `qualityScores` — from retrospective.completed events
- `costsUsd`, `runIds` — aggregated from `agentRunCosts` table

### minePatterns({ projectId, since? })

Groups archived lifecycles by (kind, role); computes consistency score = occurrences / total lifecycles.

**Idempotent:** deletes all existing patterns for the project before inserting fresh rows.

**Call site:** `POST /api/projects/:slug/learning/mine` route (manual trigger or scheduled).

### computeTrend({ projectId, role, skill?, windowSize = 5 })

Reads recent `archived_lifecycles`, extracts quality scores, returns trend.

- Returns `improving` if delta > +0.05
- Returns `declining` if delta < -0.05
- Returns `stable` otherwise

**Call site:** `core/workflows/retrospective.ts` → passes to retrospective-deep skill context.

## Schema

### archivedLifecycles table

```sql
archived_lifecycles(
  id INTEGER PRIMARY KEY,
  projectId TEXT,
  workItemId TEXT,
  closedAt TEXT,
  decisionSummaries TEXT,    -- JSON string
  learningEntries TEXT,      -- JSON string
  qualityScores TEXT,        -- JSON string
  costsUsd REAL,
  runIds TEXT                -- JSON string
)
```

### decisionPatterns table

```sql
decision_patterns(
  id INTEGER PRIMARY KEY,
  projectId TEXT,
  kind TEXT,                 -- DecisionKind enum
  role TEXT,
  actionSummary TEXT,
  reasonSummary TEXT,
  occurrenceCount INTEGER,
  consistencyScore REAL,     -- 0..1
  lastSeenAt TEXT,
  exampleWorkItemIds TEXT    -- JSON string, max 5
)
```

## Context allowlist

These exports are safe to call from slices via `@goose-hub/core/learning/...` paths.

- archiveLifecycle
- minePatterns
- computeTrend

## Testing

See `slice.test.ts` for:
- Archive write on state transition; deduplication of decision summaries
- Pattern mining: grouping by (kind, role); consistency-score math
- Trend computation: improving/declining/stable detection; edge cases (empty archive, malformed JSON)
