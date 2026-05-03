import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_RETRIES,
  getQaRetryCount,
  getReviewRetryCount,
  shouldEscalateQa,
  shouldEscalateReview,
} from './retry-counter.js';

function makeEvent(kind: string, payload: object) {
  return { kind, payload: JSON.stringify(payload) };
}

describe('retry-counter', () => {
  describe('getQaRetryCount', () => {
    it('returns 0 with no events', () => {
      expect(getQaRetryCount([])).toBe(0);
    });

    it('counts qa.completed fail events', () => {
      const events = [
        makeEvent('qa.completed', { verdict: 'fail', overallScore: 40 }),
        makeEvent('qa.completed', { verdict: 'fail', overallScore: 35 }),
      ];
      expect(getQaRetryCount(events)).toBe(2);
    });

    it('does not count qa.completed pass events', () => {
      const events = [
        makeEvent('qa.completed', { verdict: 'fail', overallScore: 40 }),
        makeEvent('qa.completed', { verdict: 'pass', overallScore: 85 }),
      ];
      expect(getQaRetryCount(events)).toBe(1);
    });

    it('does not count unrelated events', () => {
      const events = [makeEvent('agent.run-failed', { error: 'timeout' })];
      expect(getQaRetryCount(events)).toBe(0);
    });

    // Partial-verdict cases — these are the cases the original code got wrong.
    it('does NOT count partial verdict when overallScore >= 70 (treated as pass by workflow)', () => {
      const events = [makeEvent('qa.completed', { verdict: 'partial', overallScore: 75 })];
      expect(getQaRetryCount(events)).toBe(0);
    });

    it('counts partial verdict when overallScore < 70 (treated as fail by workflow)', () => {
      const events = [makeEvent('qa.completed', { verdict: 'partial', overallScore: 65 })];
      expect(getQaRetryCount(events)).toBe(1);
    });

    it('counts partial verdict when overallScore === 69 (boundary — just below threshold)', () => {
      const events = [makeEvent('qa.completed', { verdict: 'partial', overallScore: 69 })];
      expect(getQaRetryCount(events)).toBe(1);
    });

    it('does NOT count partial verdict when overallScore === 70 (boundary — at threshold)', () => {
      const events = [makeEvent('qa.completed', { verdict: 'partial', overallScore: 70 })];
      expect(getQaRetryCount(events)).toBe(0);
    });

    it('handles missing verdict gracefully — not counted (neither fail nor partial-fail)', () => {
      const events = [makeEvent('qa.completed', {})];
      // verdict is undefined — doesn't match 'fail' or ('partial' && score<70), so not counted
      expect(getQaRetryCount(events)).toBe(0);
    });
  });

  describe('getReviewRetryCount', () => {
    it('returns 0 with no events', () => {
      expect(getReviewRetryCount([])).toBe(0);
    });

    it('counts review.completed needs-fix events', () => {
      const events = [makeEvent('review.completed', { verdict: 'needs-fix', confidence: 0.7 })];
      expect(getReviewRetryCount(events)).toBe(1);
    });

    it('does not count review.completed approved events', () => {
      const events = [makeEvent('review.completed', { verdict: 'approved', confidence: 0.9 })];
      expect(getReviewRetryCount(events)).toBe(0);
    });

    it('does not count review.completed needs-human events', () => {
      const events = [
        makeEvent('review.completed', {
          verdict: 'needs-human',
          confidence: 0.3,
          escalationReason: 'ambiguous spec',
        }),
      ];
      expect(getReviewRetryCount(events)).toBe(0);
    });
  });

  describe('shouldEscalateQa', () => {
    it('returns false when retries < maxRetries', () => {
      const events = [makeEvent('qa.completed', { verdict: 'fail', overallScore: 40 })];
      expect(shouldEscalateQa(events, 2)).toBe(false);
    });

    it('returns true when retries >= maxRetries', () => {
      const events = [
        makeEvent('qa.completed', { verdict: 'fail', overallScore: 40 }),
        makeEvent('qa.completed', { verdict: 'fail', overallScore: 35 }),
      ];
      expect(shouldEscalateQa(events, 2)).toBe(true);
    });

    it('partial-pass does not count toward escalation', () => {
      const events = [
        makeEvent('qa.completed', { verdict: 'partial', overallScore: 80 }), // pass — not counted
        makeEvent('qa.completed', { verdict: 'partial', overallScore: 80 }), // pass — not counted
      ];
      // Two partial-passes should not trigger escalation
      expect(shouldEscalateQa(events, 2)).toBe(false);
    });

    it('partial-fail DOES count toward escalation', () => {
      const events = [
        makeEvent('qa.completed', { verdict: 'partial', overallScore: 60 }), // fail
        makeEvent('qa.completed', { verdict: 'partial', overallScore: 55 }), // fail
      ];
      expect(shouldEscalateQa(events, 2)).toBe(true);
    });

    it('DEFAULT_MAX_RETRIES is 2', () => {
      expect(DEFAULT_MAX_RETRIES).toBe(2);
    });
  });

  describe('shouldEscalateReview', () => {
    it('returns false when retries < maxRetries', () => {
      const events = [makeEvent('review.completed', { verdict: 'needs-fix' })];
      expect(shouldEscalateReview(events, 2)).toBe(false);
    });

    it('returns true when retries >= maxRetries', () => {
      const events = [
        makeEvent('review.completed', { verdict: 'needs-fix' }),
        makeEvent('review.completed', { verdict: 'needs-fix' }),
      ];
      expect(shouldEscalateReview(events, 2)).toBe(true);
    });
  });
});
