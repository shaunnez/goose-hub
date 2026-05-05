import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '../types.js';
import { DuplicateSlugError, detectDuplicateSlugs } from './loader.js';
import { startPerProjectScheduler } from './scheduler.js';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// detectDuplicateSlugs (pure, no mocking required)
// ---------------------------------------------------------------------------

describe('detectDuplicateSlugs', () => {
  it('does not throw when all slugs are unique', () => {
    const configs = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }] as ProjectConfig[];
    expect(() => detectDuplicateSlugs(configs)).not.toThrow();
  });

  it('throws DuplicateSlugError when two configs share a slug', () => {
    const configs = [{ slug: 'a' }, { slug: 'b' }, { slug: 'a' }] as ProjectConfig[];
    expect(() => detectDuplicateSlugs(configs)).toThrow(DuplicateSlugError);
  });

  it('includes the duplicate slug in the error', () => {
    const configs = [{ slug: 'dup' }, { slug: 'dup' }] as ProjectConfig[];
    try {
      detectDuplicateSlugs(configs);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DuplicateSlugError);
      expect((err as DuplicateSlugError).slug).toBe('dup');
    }
  });

  it('is a no-op for an empty array', () => {
    expect(() => detectDuplicateSlugs([])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DuplicateSlugError
// ---------------------------------------------------------------------------

describe('DuplicateSlugError', () => {
  it('is an instance of Error', () => {
    expect(new DuplicateSlugError('x')).toBeInstanceOf(Error);
  });

  it('carries the slug property', () => {
    const err = new DuplicateSlugError('my-slug');
    expect(err.slug).toBe('my-slug');
    expect(err.message).toContain('my-slug');
    expect(err.name).toBe('DuplicateSlugError');
  });
});

// ---------------------------------------------------------------------------
// loadProjects — filesystem error paths (mocked fs)
// ---------------------------------------------------------------------------

describe('loadProjects', () => {
  it('returns [] when projectsRoot is not readable', async () => {
    vi.doMock('node:fs', () => ({
      readdirSync: vi.fn().mockImplementation(() => {
        throw new Error('ENOENT');
      }),
      statSync: vi.fn(),
    }));
    const { loadProjects } = await import('./loader.js');
    expect(await loadProjects('/nonexistent')).toEqual([]);
  });

  it('skips entries that are not directories', async () => {
    vi.doMock('node:fs', () => ({
      readdirSync: vi.fn().mockReturnValue(['file.txt']),
      statSync: vi.fn().mockReturnValue({ isDirectory: () => false }),
    }));
    const { loadProjects } = await import('./loader.js');
    expect(await loadProjects('/some/root')).toEqual([]);
  });

  it('skips directory entries that throw on statSync', async () => {
    vi.doMock('node:fs', () => ({
      readdirSync: vi.fn().mockReturnValue(['bad-entry']),
      statSync: vi.fn().mockImplementation(() => {
        throw new Error('EPERM');
      }),
    }));
    const { loadProjects } = await import('./loader.js');
    expect(await loadProjects('/some/root')).toEqual([]);
  });

  it('skips directories with no project.config.ts', async () => {
    vi.doMock('node:fs', () => ({
      readdirSync: vi.fn().mockReturnValue(['no-config']),
      statSync: vi
        .fn()
        .mockReturnValueOnce({ isDirectory: () => true })
        .mockImplementationOnce(() => {
          throw new Error('ENOENT');
        }),
    }));
    const { loadProjects } = await import('./loader.js');
    expect(await loadProjects('/some/root')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getProjectBySlug — filesystem error paths (mocked fs)
// ---------------------------------------------------------------------------

describe('getProjectBySlug', () => {
  it('returns null when the config file does not exist', async () => {
    vi.doMock('node:fs', () => ({
      readdirSync: vi.fn(),
      statSync: vi.fn().mockImplementation(() => {
        throw new Error('ENOENT');
      }),
    }));
    const { getProjectBySlug } = await import('./loader.js');
    expect(await getProjectBySlug('missing-slug', '/some/root')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// startPerProjectScheduler
// ---------------------------------------------------------------------------

describe('startPerProjectScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeProject(slug: string, tickIntervalSeconds?: number): ProjectConfig {
    return { slug, tickIntervalSeconds } as unknown as ProjectConfig;
  }

  it('fires tickFn once per project after one interval', async () => {
    const tickA = vi.fn().mockResolvedValue(undefined);
    const tickB = vi.fn().mockResolvedValue(undefined);
    const calls: string[] = [];
    const scheduler = startPerProjectScheduler(
      [makeProject('proj-a', 10), makeProject('proj-b', 20)],
      async (slug) => {
        calls.push(slug);
        if (slug === 'proj-a') await tickA();
        else await tickB();
      },
    );

    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toContain('proj-a');
    expect(calls).not.toContain('proj-b');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.filter((s) => s === 'proj-a').length).toBe(2);
    expect(calls.filter((s) => s === 'proj-b').length).toBe(1);

    scheduler.stop();
  });

  it('uses default 60s interval when tickIntervalSeconds is not set', async () => {
    const ticks: string[] = [];
    const scheduler = startPerProjectScheduler([makeProject('default-proj')], async (slug) => {
      ticks.push(slug);
    });

    await vi.advanceTimersByTimeAsync(59_999);
    expect(ticks).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(ticks).toHaveLength(1);

    scheduler.stop();
  });

  it('errors in one project tick do not stop the other project timer', async () => {
    const bTicks: string[] = [];
    const scheduler = startPerProjectScheduler(
      [makeProject('bad-proj', 5), makeProject('good-proj', 5)],
      async (slug) => {
        if (slug === 'bad-proj') throw new Error('boom');
        bTicks.push(slug);
      },
    );

    await vi.advanceTimersByTimeAsync(5_000);
    // bad-proj threw but good-proj still fired
    expect(bTicks).toContain('good-proj');

    scheduler.stop();
  });

  it('stop() cancels all timers', async () => {
    const ticks: string[] = [];
    const scheduler = startPerProjectScheduler([makeProject('proj', 5)], async (slug) => {
      ticks.push(slug);
    });

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ticks).toHaveLength(0);
  });

  it('returns immediately when given an empty project list', () => {
    const scheduler = startPerProjectScheduler([], async () => {});
    expect(() => scheduler.stop()).not.toThrow();
  });
});
