// core/retry/retry-counter.ts
// Tracks retry counts using events already in the event store.
// No new DB table needed — counts domain events per work item.
//
// Semantics: call these functions with events collected BEFORE the current
// run's outcome is appended. That way count reflects prior failures only,
// and escalation triggers on the (maxRetries+1)th failure:
//   maxRetries=2 → escalate on 3rd failure (2 qa-failed cycles, then needs-human)

export const DEFAULT_MAX_RETRIES = 2;

type EventLike = { kind: string; payload: string | unknown };

type QaPayload = { verdict?: string; overallScore?: number };

/**
 * Counts prior QA failures for a work item.
 * A failure is: verdict === 'fail', OR verdict === 'partial' with overallScore < 70
 * (mirrors the pass logic in slices/qa/workflow.ts).
 * Call with events collected BEFORE the current qa.completed is appended.
 */
export function getQaRetryCount(events: EventLike[]): number {
  return events.filter((e) => {
    if (e.kind !== 'qa.completed') return false;
    const p = (typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload) as QaPayload;
    return p.verdict === 'fail' || (p.verdict === 'partial' && (p.overallScore ?? 0) < 70);
  }).length;
}

/**
 * Counts prior Review fix-requests for a work item.
 * Call with events collected BEFORE the current review.completed is appended.
 */
export function getReviewRetryCount(events: EventLike[]): number {
  return events.filter((e) => {
    if (e.kind !== 'review.completed') return false;
    const p = (typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload) as {
      verdict?: string;
    };
    return p.verdict === 'needs-fix';
  }).length;
}

export function shouldEscalateQa(events: EventLike[], maxRetries = DEFAULT_MAX_RETRIES): boolean {
  return getQaRetryCount(events) >= maxRetries;
}

export function shouldEscalateReview(
  events: EventLike[],
  maxRetries = DEFAULT_MAX_RETRIES,
): boolean {
  return getReviewRetryCount(events) >= maxRetries;
}
