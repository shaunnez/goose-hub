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
  });

  describe('shouldEscalateQa', () => {
    it('returns false when retries < maxRetries', () => {
      const events = [makeEvent('qa.completed', { verdict: 'fail' })];
      expect(shouldEscalateQa(events, 2)).toBe(false);
    });
    it('returns true when retries >= maxRetries', () => {
      const events = [
        makeEvent('qa.completed', { verdict: 'fail' }),
        makeEvent('qa.completed', { verdict: 'fail' }),
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
