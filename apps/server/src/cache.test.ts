import { describe, expect, it, vi } from 'vitest';
import { bustCache, getCached } from './cache.js';

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
});
