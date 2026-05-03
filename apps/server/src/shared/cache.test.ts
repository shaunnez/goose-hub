import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_KEY, bustCache, getCacheSize, getCached } from './cache.js';

// Helper: flush all known test keys before each test so tests don't share state
const TEST_KEYS = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10'];

beforeEach(() => {
  vi.restoreAllMocks();
  for (const k of TEST_KEYS) bustCache(k);
});

describe('getCached', () => {
  it('calls fetcher on first call and returns its value', async () => {
    const fetcher = vi.fn().mockResolvedValue('hello');
    const result = await getCached('t1', 60_000, fetcher);
    expect(result).toBe('hello');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('returns cached value without calling fetcher again within TTL', async () => {
    const fetcher = vi.fn().mockResolvedValue('data');
    await getCached('t2', 60_000, fetcher);
    const second = await getCached('t2', 60_000, fetcher);
    expect(second).toBe('data');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('refetches after bustCache', async () => {
    const fetcher = vi.fn().mockResolvedValue('value');
    await getCached('t3', 60_000, fetcher);
    bustCache('t3');
    await getCached('t3', 60_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refetches after TTL expires', async () => {
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetcher = vi.fn().mockResolvedValue('fresh');
    await getCached('t4', 1_000, fetcher);
    spy.mockReturnValue(now + 1_001);
    await getCached('t4', 1_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it('does not refetch when still within TTL window', async () => {
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    const fetcher = vi.fn().mockResolvedValue('stable');
    await getCached('t5', 5_000, fetcher);
    spy.mockReturnValue(now + 4_999);
    const second = await getCached('t5', 5_000, fetcher);
    expect(second).toBe('stable');
    expect(fetcher).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it('handles a fetcher that returns null', async () => {
    const fetcher = vi.fn().mockResolvedValue(null);
    const result = await getCached('t6', 60_000, fetcher);
    expect(result).toBeNull();
  });

  it('handles a fetcher that returns an object', async () => {
    const obj = { a: 1, b: 'two' };
    const fetcher = vi.fn().mockResolvedValue(obj);
    const result = await getCached<typeof obj>('t7', 60_000, fetcher);
    expect(result).toEqual(obj);
  });
});

describe('bustCache', () => {
  it('does not throw when busting a key that does not exist', () => {
    expect(() => bustCache('non-existent-key-xyz')).not.toThrow();
  });

  it('busting a key causes next getCached to re-fetch', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');
    await getCached('t8', 60_000, fetcher);
    bustCache('t8');
    const result = await getCached('t8', 60_000, fetcher);
    expect(result).toBe('v2');
  });
});

describe('getCacheSize', () => {
  it('returns a non-negative number', () => {
    const size = getCacheSize();
    expect(typeof size).toBe('number');
    expect(size).toBeGreaterThanOrEqual(0);
  });

  it('increases after a cache write', async () => {
    const before = getCacheSize();
    const fetcher = vi.fn().mockResolvedValue('x');
    await getCached('t9', 60_000, fetcher);
    expect(getCacheSize()).toBe(before + 1);
    bustCache('t9');
  });

  it('decreases after bustCache', async () => {
    const fetcher = vi.fn().mockResolvedValue('y');
    await getCached('t10', 60_000, fetcher);
    const before = getCacheSize();
    bustCache('t10');
    expect(getCacheSize()).toBe(before - 1);
  });
});

describe('CACHE_KEY helpers', () => {
  it('issues key includes slug', () => {
    expect(CACHE_KEY.issues('my-project')).toBe('issues:my-project');
  });

  it('milestones key includes slug', () => {
    expect(CACHE_KEY.milestones('my-project')).toBe('milestones:my-project');
  });

  it('closedIssues key includes slug and milestone number', () => {
    expect(CACHE_KEY.closedIssues('my-project', 3)).toBe('closed-issues:my-project:3');
  });

  it('milestoneIssues key includes slug and milestone number', () => {
    expect(CACHE_KEY.milestoneIssues('my-project', 7)).toBe('milestone-issues:my-project:7');
  });

  it('different slugs produce different keys', () => {
    expect(CACHE_KEY.issues('alpha')).not.toBe(CACHE_KEY.issues('beta'));
  });
});

describe('getCached — capacity eviction', () => {
  it('purges expired entries when store reaches MAX_ENTRIES (500)', async () => {
    const past = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(past);

    for (let i = 0; i < 500; i++) {
      await getCached(`evict-${i}`, 0, () => Promise.resolve(i));
    }

    // Advance time so all previously written entries are expired
    nowSpy.mockReturnValue(past + 1);

    // Writing one more entry should trigger purge of expired entries
    const fetcher = vi.fn().mockResolvedValue('after-evict');
    const result = await getCached('evict-trigger', 60_000, fetcher);
    expect(result).toBe('after-evict');

    vi.restoreAllMocks();
    bustCache('evict-trigger');
    for (let i = 0; i < 500; i++) {
      bustCache(`evict-${i}`);
    }
  });
});
