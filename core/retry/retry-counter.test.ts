import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_RETRIES,
  getQaRetryCount,
  getReviewRetryCount,
  shouldEscalateQa,
  shouldEscalateReview,
} from './retry-counter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function qaEvent(verdict: string, overallScore?: number) {
  return { kind: 'qa.completed', payload: { verdict, overallScore } };
}

function reviewEvent(verdict: string) {
  return { kind: 'review.completed', payload: { verdict } };
}

function qaEventStr(verdict: string, overallScore?: number) {
  return { kind: 'qa.completed', payload: JSON.stringify({ verdict, overallScore }) };
}

function reviewEventStr(verdict: string) {
  return { kind: 'review.completed', payload: JSON.stringify({ verdict }) };
}

// ---------------------------------------------------------------------------
// DEFAULT_MAX_RETRIES
// ---------------------------------------------------------------------------

describe('DEFAULT_MAX_RETRIES', () => {
  it('is 2', () => {
    expect(DEFAULT_MAX_RETRIES).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getQaRetryCount
// ---------------------------------------------------------------------------

describe('getQaRetryCount', () => {
  it('returns 0 for an empty event list', () => {
    expect(getQaRetryCount([])).toBe(0);
  });

  it('counts verdict=fail as a failure', () => {
    const events = [qaEvent('fail')];
    expect(getQaRetryCount(events)).toBe(1);
  });

  it('counts verdict=partial with overallScore < 70 as a failure', () => {
    const events = [qaEvent('partial', 50)];
    expect(getQaRetryCount(events)).toBe(1);
  });

  it('counts verdict=partial with overallScore === 69 as a failure', () => {
    const events = [qaEvent('partial', 69)];
    expect(getQaRetryCount(events)).toBe(1);
  });

  it('does NOT count verdict=partial with overallScore >= 70 as a failure', () => {
    const events = [qaEvent('partial', 70), qaEvent('partial', 90)];
    expect(getQaRetryCount(events)).toBe(0);
  });

  it('does NOT count verdict=pass as a failure', () => {
    const events = [qaEvent('pass')];
    expect(getQaRetryCount(events)).toBe(0);
  });

  it('ignores non-qa.completed events', () => {
    const events = [
      { kind: 'system.note', payload: { verdict: 'fail' } },
      { kind: 'review.completed', payload: { verdict: 'needs-fix' } },
    ];
    expect(getQaRetryCount(events)).toBe(0);
  });

  it('accumulates multiple failures', () => {
    const events = [qaEvent('fail'), qaEvent('fail'), qaEvent('pass'), qaEvent('partial', 40)];
    expect(getQaRetryCount(events)).toBe(3);
  });

  it('handles payload as a JSON string (string serialisation path)', () => {
    const events = [qaEventStr('fail'), qaEventStr('partial', 50)];
    expect(getQaRetryCount(events)).toBe(2);
  });

  it('counts verdict=partial with no overallScore (defaults to 0, i.e. < 70) as failure', () => {
    const events = [qaEvent('partial')];
    // overallScore defaults to 0 in the implementation: (p.overallScore ?? 0) < 70
    expect(getQaRetryCount(events)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getReviewRetryCount
// ---------------------------------------------------------------------------

describe('getReviewRetryCount', () => {
  it('returns 0 for an empty event list', () => {
    expect(getReviewRetryCount([])).toBe(0);
  });

  it('counts verdict=needs-fix as a fix-request', () => {
    const events = [reviewEvent('needs-fix')];
    expect(getReviewRetryCount(events)).toBe(1);
  });

  it('does NOT count verdict=approved as a fix-request', () => {
    const events = [reviewEvent('approved')];
    expect(getReviewRetryCount(events)).toBe(0);
  });

  it('ignores non-review.completed events', () => {
    const events = [
      { kind: 'qa.completed', payload: { verdict: 'needs-fix' } },
      { kind: 'system.note', payload: { verdict: 'needs-fix' } },
    ];
    expect(getReviewRetryCount(events)).toBe(0);
  });

  it('accumulates multiple fix-requests', () => {
    const events = [reviewEvent('needs-fix'), reviewEvent('approved'), reviewEvent('needs-fix')];
    expect(getReviewRetryCount(events)).toBe(2);
  });

  it('handles payload as a JSON string (string serialisation path)', () => {
    const events = [reviewEventStr('needs-fix'), reviewEventStr('needs-fix')];
    expect(getReviewRetryCount(events)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// shouldEscalateQa
// ---------------------------------------------------------------------------

describe('shouldEscalateQa', () => {
  it('returns false when retry count is below maxRetries', () => {
    const events = [qaEvent('fail')]; // count=1, max=2
    expect(shouldEscalateQa(events)).toBe(false);
  });

  it('returns true when retry count equals maxRetries', () => {
    const events = [qaEvent('fail'), qaEvent('fail')]; // count=2, max=2
    expect(shouldEscalateQa(events)).toBe(true);
  });

  it('returns true when retry count exceeds maxRetries', () => {
    const events = [qaEvent('fail'), qaEvent('fail'), qaEvent('fail')]; // count=3
    expect(shouldEscalateQa(events)).toBe(true);
  });

  it('returns false with no events', () => {
    expect(shouldEscalateQa([])).toBe(false);
  });

  it('respects a custom maxRetries value', () => {
    const events = [qaEvent('fail')]; // count=1
    expect(shouldEscalateQa(events, 1)).toBe(true);
    expect(shouldEscalateQa(events, 3)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldEscalateReview
// ---------------------------------------------------------------------------

describe('shouldEscalateReview', () => {
  it('returns false when retry count is below maxRetries', () => {
    const events = [reviewEvent('needs-fix')]; // count=1, max=2
    expect(shouldEscalateReview(events)).toBe(false);
  });

  it('returns true when retry count equals maxRetries', () => {
    const events = [reviewEvent('needs-fix'), reviewEvent('needs-fix')]; // count=2
    expect(shouldEscalateReview(events)).toBe(true);
  });

  it('returns true when retry count exceeds maxRetries', () => {
    const events = [reviewEvent('needs-fix'), reviewEvent('needs-fix'), reviewEvent('needs-fix')];
    expect(shouldEscalateReview(events)).toBe(true);
  });

  it('returns false with no events', () => {
    expect(shouldEscalateReview([])).toBe(false);
  });

  it('respects a custom maxRetries value', () => {
    const events = [reviewEvent('needs-fix')]; // count=1
    expect(shouldEscalateReview(events, 1)).toBe(true);
    expect(shouldEscalateReview(events, 3)).toBe(false);
  });
});
