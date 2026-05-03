// core/retry/retry-counter.ts
// Tracks retry counts using events already in the event store.
// No new DB table needed — counts domain events per work item.

export const DEFAULT_MAX_RETRIES = 2;

type EventLike = { kind: string; payload: string | unknown };

/**
 * Counts how many times QA has failed for a work item.
 * Uses qa.completed events with non-pass verdict as the signal.
 */
export function getQaRetryCount(events: EventLike[]): number {
  return events.filter((e) => {
    if (e.kind !== 'qa.completed') return false;
    const payload = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
    return (payload as { verdict?: string }).verdict !== 'pass';
  }).length;
}

/**
 * Counts how many times Review has requested fixes for a work item.
 */
export function getReviewRetryCount(events: EventLike[]): number {
  return events.filter((e) => {
    if (e.kind !== 'review.completed') return false;
    const payload = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
    return (payload as { verdict?: string }).verdict === 'needs-fix';
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
