# retry-escalate

Utility slice that tracks retry counts for QA and Review failures, and decides when to escalate a work item to `factory:needs-human` instead of re-queuing it.

## Purpose

When QA fails (`factory:qa-failed`) or Review requests fixes (`factory:needs-fix`), the orchestrator normally re-runs the Dev agent for another attempt. After `maxRetries` attempts the item is escalated to `factory:needs-human` so a human can intervene.

This slice provides the counter and predicate functions. It does **not** own any DB table — retry counts are derived by reading the existing `events` table via `eventStore.replay`.

## Constants

- `DEFAULT_MAX_RETRIES = 2` — M8 definition. Change here to affect all callers.

## API

```typescript
getQaRetryCount(events)       // number of qa.completed non-pass events
getReviewRetryCount(events)   // number of review.completed needs-fix events
shouldEscalateQa(events, maxRetries?)     // true when QA retries exhausted
shouldEscalateReview(events, maxRetries?) // true when Review retries exhausted
```

## Consumers

- `slices/qa/workflow.ts` — calls `shouldEscalateQa` after each QA fail verdict
- `slices/review/workflow.ts` — calls `shouldEscalateReview` after each needs-fix verdict

## Emitted events

When escalation is triggered, callers emit `agent.retry-escalated` with:

```json
{ "stage": "qa" | "review", "maxRetries": 2, "runId": "<uuid>" }
```
