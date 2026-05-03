// slices/retry-escalate/retry-counter.ts
// Tracks retry counts using events already in the event store.
// No new DB table needed.

export const DEFAULT_MAX_RETRIES = 2;

/**
 * Counts how many times QA has failed for a work item.
 * Uses qa.completed events with non-pass verdict as the signal.
 */
export function getQaRetryCount(
  events: Array<{ kind: string; payload: string | unknown }>,
): number {
  return events.filter((e) => {
    if (e.kind !== 'qa.completed') return false;
    const payload = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
    return (payload as { verdict?: string }).verdict !== 'pass';
  }).length;
}

/**
 * Counts how many times Review has requested fixes for a work item.
 */
export function getReviewRetryCount(
  events: Array<{ kind: string; payload: string | unknown }>,
): number {
  return events.filter((e) => {
    if (e.kind !== 'review.completed') return false;
    const payload = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
    return (payload as { verdict?: string }).verdict === 'needs-fix';
  }).length;
}

export function shouldEscalateQa(
  events: Array<{ kind: string; payload: string | unknown }>,
  maxRetries = DEFAULT_MAX_RETRIES,
): boolean {
  return getQaRetryCount(events) >= maxRetries;
}

export function shouldEscalateReview(
  events: Array<{ kind: string; payload: string | unknown }>,
  maxRetries = DEFAULT_MAX_RETRIES,
): boolean {
  return getReviewRetryCount(events) >= maxRetries;
}
