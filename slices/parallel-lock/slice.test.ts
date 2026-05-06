import { ProjectParallelLock } from '@goose-hub/core/projects/parallel-lock.js';
import { describe, expect, it } from 'vitest';

/**
 * End-to-end slice tests for M11.08: multi-parallel project lock relaxation.
 *
 * These tests exercise the lock directly (the unit that dispatch.ts wraps)
 * to verify the three key scenarios from the acceptance criteria.
 */

describe('parallel-lock slice — M11.08', () => {
  // ---------------------------------------------------------------------------
  // maxParallelAgents=1: original single-workflow-per-project behaviour
  // ---------------------------------------------------------------------------

  describe('maxParallelAgents=1 (original behaviour preserved)', () => {
    it('allows exactly one workflow per project', () => {
      const lock = new ProjectParallelLock();
      expect(lock.tryAcquire('goose-hub-self', 101, 1)).toBe(true);
      expect(lock.inFlightCount('goose-hub-self')).toBe(1);
    });

    it('rejects a second workflow on the same issue', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('goose-hub-self', 101, 1);
      expect(lock.tryAcquire('goose-hub-self', 101, 1)).toBe(false);
    });

    it('rejects a second workflow on a different issue (project cap)', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('goose-hub-self', 101, 1);
      expect(lock.tryAcquire('goose-hub-self', 102, 1)).toBe(false);
    });

    it('allows next workflow after first completes', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('goose-hub-self', 101, 1);
      lock.release('goose-hub-self', 101);
      expect(lock.tryAcquire('goose-hub-self', 102, 1)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // maxParallelAgents=2: two distinct issues dispatched in the same tick
  // ---------------------------------------------------------------------------

  describe('maxParallelAgents=2 — two eligible issues dispatched in parallel', () => {
    it('two distinct issues both acquire (non-conflicting)', () => {
      const lock = new ProjectParallelLock();
      expect(lock.tryAcquire('goose-hub-self', 200, 2)).toBe(true);
      expect(lock.tryAcquire('goose-hub-self', 201, 2)).toBe(true);
      expect(lock.inFlightCount('goose-hub-self')).toBe(2);
    });

    it('budget cap rejects a 3rd issue when maxParallelAgents=2', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('goose-hub-self', 200, 2);
      lock.tryAcquire('goose-hub-self', 201, 2);

      // 3rd attempt must be rejected — cap reached
      expect(lock.tryAcquire('goose-hub-self', 202, 2)).toBe(false);
      expect(lock.inFlightCount('goose-hub-self')).toBe(2);
    });

    it('completing one of the two allows the 3rd to proceed', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('goose-hub-self', 200, 2);
      lock.tryAcquire('goose-hub-self', 201, 2);
      lock.release('goose-hub-self', 200);

      expect(lock.tryAcquire('goose-hub-self', 202, 2)).toBe(true);
    });

    it('per-issue lock still enforced within parallel window', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('goose-hub-self', 200, 2);

      // Same issue rejected even though cap not reached
      expect(lock.tryAcquire('goose-hub-self', 200, 2)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Budget cap enforced per-dispatch, not just on first
  // ---------------------------------------------------------------------------

  describe('budget cap enforced before each dispatch', () => {
    it('cap is checked fresh on every tryAcquire call, not just the first', () => {
      const lock = new ProjectParallelLock();

      // Fill the cap
      lock.tryAcquire('proj', 1, 2);
      lock.tryAcquire('proj', 2, 2);

      // Each subsequent attempt is independently rejected
      expect(lock.tryAcquire('proj', 3, 2)).toBe(false);
      expect(lock.tryAcquire('proj', 4, 2)).toBe(false);
      expect(lock.tryAcquire('proj', 5, 2)).toBe(false);

      // After one finishes, the cap is re-checked and one more is allowed
      lock.release('proj', 1);
      expect(lock.tryAcquire('proj', 3, 2)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-project isolation
  // ---------------------------------------------------------------------------

  describe('project isolation', () => {
    it('cap for project A does not affect project B', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('proj-a', 1, 1);

      // proj-b's cap is independent — should succeed
      expect(lock.tryAcquire('proj-b', 1, 1)).toBe(true);
    });
  });
});
