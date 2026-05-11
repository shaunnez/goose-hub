# core/retry

Retry counters for QA and Review failures. Counts are derived from the event stream — no separate retry table.

## Exports

### `getQaRetryCount(events): number`

Counts prior QA failures for a work item: events where `kind === 'qa.completed'` and either `verdict === 'fail'` or `verdict === 'partial'` with `overallScore < 70` (mirrors the pass logic in `slices/qa/workflow.ts`).

### `getReviewRetryCount(events): number`

Counts prior Review fix-requests: events where `kind === 'review.completed'` and `verdict === 'needs-fix'`.

### `DEFAULT_MAX_RETRIES = 2`

Default cap. After this many failures the slice escalates to `factory:needs-human` per FACTORY_RULES rule 18.

## Calling convention

Call these functions with events collected **before** the current run's outcome is appended. That way count reflects prior failures only, and escalation triggers on the `(maxRetries+1)`-th failure: with `maxRetries=2`, escalation fires on the third failure (after two QA-failed cycles).

## Consumers

- `slices/retry-escalate` — gates dispatch and escalates work items when the cap is hit.
- `slices/qa/workflow.ts` and `slices/review/workflow.ts` — call these to decide between "loop back to fix" and "escalate to human."
