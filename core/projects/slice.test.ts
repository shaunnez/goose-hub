import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '../types.js';
import { DuplicateSlugError, detectDuplicateSlugs } from './loader.js';

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
