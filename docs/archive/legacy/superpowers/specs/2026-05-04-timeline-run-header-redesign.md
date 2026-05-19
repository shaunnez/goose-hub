# Timeline Run Header Redesign

**Date:** 2026-05-04
**Status:** Approved

## Problem

Run groups in the timeline show a raw GUID as their title ("Run cdfd6cf7-...") and a raw ISO timestamp ("Started at: 2026-05-04 02:27:10"). There is no live/complete status, no human-readable run duration, and no in-progress indicator when a run has not yet completed.

## Design

### Data layer — `timeline.ts`

Extend the `run-group` variant of `RenderItem` with computed metadata:

```ts
| {
    kind: 'run-group';
    runId: string;
    items: RenderItem[];
    skill: string | null;       // e.g. "implement", "triage", null
    startedAt: string | null;   // ISO string, from agent.run-started or earliest event
    endedAt: string | null;     // ISO string from agent.run-completed/failed; null if live
  }
```

`groupByRunId` populates these fields by scanning each group's items:

- **`skill`**: first non-null `payload.skill` found checking `agent.run-started`, then `agent.spawned`, then `agent.run-completed` payloads
- **`startedAt`**: `createdAt` of first `agent.run-started` event; falls back to numerically earliest event in the group
- **`endedAt`**: `createdAt` of first `agent.run-completed` or `agent.run-failed` event; `null` if neither exists

`isLive` is derived at render time: `endedAt === null`.

The standalone `getRunStartedAt` function in `TimelineSection.tsx` is deleted — superseded by `startedAt` on the type.

### Display layer — `RunGroupWrapper`

**Run header** (replaces `Run {runId}` + `Started at: {rawIso}`):

| Element | Content |
|---|---|
| Title | `formatSkillName(skill) + " Run"` — e.g. "Implement Run", "Repo Match Run", "(Unknown) Run" |
| GUID tooltip | Native `title` attribute on the title `<span>` |
| Status badge (live) | Animated green pulse dot + "Live" |
| Status badge (complete) | "Complete" (no colour) |
| Status badge (failed) | "Failed" in red |
| Live duration | "running for Xm Ys" — updates every second via `useState` + `useEffect` interval |
| Complete duration | "Ran for Xm Ys · Started HH:MM:SS · Ended HH:MM:SS" |

**Loading card** (new): first child inside the inner `<ol>` when `isLive === true`. Shows a pulsing spinner + "Agent running…". Removed automatically once `endedAt` becomes non-null (i.e. live SSE event arrives completing the run).

### Helpers added to `TimelineSection.tsx`

```ts
function formatSkillName(skill: string | null): string
// null → "(Unknown)"
// "implement" → "Implement"
// "repo-match" → "Repo Match"
// appends " Run" at call site

function formatDuration(ms: number): string
// < 60s  → "Xs"
// >= 60s → "Xm Ys"
```

## Files Changed

| File | Change |
|---|---|
| `apps/web/src/components/detail/lib/timeline.ts` | Extend `RenderItem` run-group variant; populate `skill`, `startedAt`, `endedAt` in `groupByRunId` |
| `apps/web/src/components/detail/components/TimelineSection.tsx` | Update `RunGroupWrapper`; add `formatSkillName`, `formatDuration`; delete `getRunStartedAt` |
| `apps/web/src/components/detail/components/TimelineSection.test.ts` | Update tests for new run-group shape |

## Non-goals

- No changes to event emission, server, or DB
- No new dependencies
- No changes to how events are grouped — only metadata enrichment
