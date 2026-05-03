// Re-exports from core/retry/ — the canonical implementation lives there.
// This file exists so slices/retry-escalate/slice.test.ts can import locally.
export {
  DEFAULT_MAX_RETRIES,
  getQaRetryCount,
  getReviewRetryCount,
  shouldEscalateQa,
  shouldEscalateReview,
} from '@goose-hub/core/retry/retry-counter.js';
