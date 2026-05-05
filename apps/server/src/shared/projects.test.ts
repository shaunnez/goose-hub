import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * projects.ts is now a thin wrapper over @goose-hub/core/projects/loader.
 * Unit tests for the loader internals live in core/projects/slice.test.ts.
 * These tests verify the server-layer mapping (ProjectConfig → ProjectSummary).
 */

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('listProjects', () => {
  it('returns [] when the core loader returns no projects', async () => {
    vi.doMock('@goose-hub/core/projects/loader.js', () => ({
      loadProjects: vi.fn().mockResolvedValue([]),
      getProjectBySlug: vi.fn().mockResolvedValue(null),
      detectDuplicateSlugs: vi.fn(),
      DuplicateSlugError: class DuplicateSlugError extends Error {},
    }));
    const { listProjects } = await import('./projects.js');
    expect(await listProjects()).toEqual([]);
  });

  it('maps colorStripe from ProjectConfig to color in ProjectSummary', async () => {
    const fakeConfig = {
      id: 'test-id',
      name: 'Test Project',
      slug: 'test-project',
      colorStripe: '#aabbcc',
      source: { kind: 'github', repo: 'owner/repo', stateMachine: 'labels' },
      targetRepo: { defaultBranch: 'main', cloneUrl: '', localPath: '' },
    };
    vi.doMock('@goose-hub/core/projects/loader.js', () => ({
      loadProjects: vi.fn().mockResolvedValue([fakeConfig]),
      getProjectBySlug: vi.fn().mockResolvedValue(null),
      detectDuplicateSlugs: vi.fn(),
      DuplicateSlugError: class DuplicateSlugError extends Error {},
    }));
    const { listProjects } = await import('./projects.js');
    const result = await listProjects();
    expect(result).toHaveLength(1);
    expect(result[0].color).toBe('#aabbcc');
    expect(result[0].slug).toBe('test-project');
    expect(result[0].defaultBranch).toBe('main');
  });

  it('falls back to "main" when targetRepo.defaultBranch is absent', async () => {
    const fakeConfig = {
      id: 'x',
      name: 'X',
      slug: 'x',
      colorStripe: '#000',
      source: { kind: 'github', repo: 'o/r', stateMachine: 'labels' },
      targetRepo: { cloneUrl: '', localPath: '' }, // no defaultBranch
    };
    vi.doMock('@goose-hub/core/projects/loader.js', () => ({
      loadProjects: vi.fn().mockResolvedValue([fakeConfig]),
      getProjectBySlug: vi.fn().mockResolvedValue(null),
      detectDuplicateSlugs: vi.fn(),
      DuplicateSlugError: class DuplicateSlugError extends Error {},
    }));
    const { listProjects } = await import('./projects.js');
    const [project] = await listProjects();
    expect(project.defaultBranch).toBe('main');
  });
});

describe('getProject', () => {
  it('returns null when the core loader returns null', async () => {
    vi.doMock('@goose-hub/core/projects/loader.js', () => ({
      loadProjects: vi.fn().mockResolvedValue([]),
      getProjectBySlug: vi.fn().mockResolvedValue(null),
      detectDuplicateSlugs: vi.fn(),
      DuplicateSlugError: class DuplicateSlugError extends Error {},
    }));
    const { getProject } = await import('./projects.js');
    expect(await getProject('non-existent')).toBeNull();
  });

  it('delegates to getProjectBySlug and returns the config', async () => {
    const fakeConfig = { slug: 'my-project', colorStripe: '#fff' };
    vi.doMock('@goose-hub/core/projects/loader.js', () => ({
      loadProjects: vi.fn().mockResolvedValue([]),
      getProjectBySlug: vi.fn().mockResolvedValue(fakeConfig),
      detectDuplicateSlugs: vi.fn(),
      DuplicateSlugError: class DuplicateSlugError extends Error {},
    }));
    const { getProject } = await import('./projects.js');
    const result = await getProject('my-project');
    expect(result).toEqual(fakeConfig);
  });
});
