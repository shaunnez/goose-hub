import { describe, expect, it } from 'vitest';
import { ProjectParallelLock } from './parallel-lock.js';

describe('ProjectParallelLock', () => {
  // ---------------------------------------------------------------------------
  // tryAcquire — maxParallelAgents=1 (original single-workflow behaviour)
  // ---------------------------------------------------------------------------

  describe('maxParallelAgents=1 (original behaviour)', () => {
    it('first acquire on an empty project succeeds', () => {
      const lock = new ProjectParallelLock();
      expect(lock.tryAcquire('proj', 1, 1)).toBe(true);
    });

    it('second acquire on the same issue is rejected (per-issue lock)', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('proj', 1, 1);
      expect(lock.tryAcquire('proj', 1, 1)).toBe(false);
    });

    it('second acquire on a different issue is rejected (project cap=1)', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('proj', 1, 1);
      expect(lock.tryAcquire('proj', 2, 1)).toBe(false);
    });

    it('after release the slot is free again', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('proj', 1, 1);
      lock.release('proj', 1);
      expect(lock.tryAcquire('proj', 2, 1)).toBe(true);
    });

    it('release on a non-held issue is a no-op', () => {
      const lock = new ProjectParallelLock();
      expect(() => lock.release('proj', 99)).not.toThrow();
    });

    it('releasing the last issue removes the slug entry (no memory leak)', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('proj', 1, 1);
      lock.release('proj', 1);
      // inFlightCount uses the map internally; 0 confirms the entry was cleaned up
      expect(lock.inFlightCount('proj')).toBe(0);
      // A fresh acquire must still work after the cleanup
      expect(lock.tryAcquire('proj', 2, 1)).toBe(true);
    });

    it('defaults maxParallelAgents to 1 when omitted', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('proj', 1);
      expect(lock.tryAcquire('proj', 2)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // tryAcquire — maxParallelAgents=2 (two issues can run in parallel)
  // ---------------------------------------------------------------------------

  describe('maxParallelAgents=2', () => {
    it('two distinct issues both acquire successfully', () => {
      const lock = new ProjectParallelLock();
      expect(lock.tryAcquire('proj', 10, 2)).toBe(true);
      expect(lock.tryAcquire('proj', 20, 2)).toBe(true);
    });

    it('budget cap rejects a 3rd distinct issue', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('proj', 10, 2);
      lock.tryAcquire('proj', 20, 2);
      expect(lock.tryAcquire('proj', 30, 2)).toBe(false);
    });

    it('same issue rejected even when cap not reached', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('proj', 10, 2);
      expect(lock.tryAcquire('proj', 10, 2)).toBe(false);
    });

    it('releasing one slot allows a 3rd issue to acquire', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('proj', 10, 2);
      lock.tryAcquire('proj', 20, 2);
      lock.release('proj', 10);
      expect(lock.tryAcquire('proj', 30, 2)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // inFlightCount
  // ---------------------------------------------------------------------------

  describe('inFlightCount', () => {
    it('returns 0 for an unknown slug', () => {
      const lock = new ProjectParallelLock();
      expect(lock.inFlightCount('unknown')).toBe(0);
    });

    it('increments on acquire, decrements on release', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('proj', 1, 3);
      expect(lock.inFlightCount('proj')).toBe(1);
      lock.tryAcquire('proj', 2, 3);
      expect(lock.inFlightCount('proj')).toBe(2);
      lock.release('proj', 1);
      expect(lock.inFlightCount('proj')).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // isInFlight
  // ---------------------------------------------------------------------------

  describe('isInFlight', () => {
    it('returns false when the issue has no in-flight workflow', () => {
      const lock = new ProjectParallelLock();
      expect(lock.isInFlight('proj', 5)).toBe(false);
    });

    it('returns true after acquiring the issue', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('proj', 5, 1);
      expect(lock.isInFlight('proj', 5)).toBe(true);
    });

    it('returns false after releasing the issue', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('proj', 5, 1);
      lock.release('proj', 5);
      expect(lock.isInFlight('proj', 5)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Project isolation
  // ---------------------------------------------------------------------------

  describe('project isolation', () => {
    it('locks on different slugs are independent', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('proj-a', 1, 1);
      expect(lock.tryAcquire('proj-b', 1, 1)).toBe(true);
    });

    it('inFlightCount is per-slug', () => {
      const lock = new ProjectParallelLock();
      lock.tryAcquire('proj-a', 1, 2);
      lock.tryAcquire('proj-a', 2, 2);
      expect(lock.inFlightCount('proj-a')).toBe(2);
      expect(lock.inFlightCount('proj-b')).toBe(0);
    });
  });
});
