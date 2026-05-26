import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidSlug } from './source.js';

// ---------------------------------------------------------------------------
// isValidSlug (#201) — branch coverage
// ---------------------------------------------------------------------------

describe('isValidSlug (#201)', () => {
  it('accepts lowercase alphanumeric with dashes', () => {
    expect(isValidSlug('goose-hub')).toBe(true);
    expect(isValidSlug('phaser-game-2')).toBe(true);
    expect(isValidSlug('a')).toBe(true);
    expect(isValidSlug('123')).toBe(true);
  });

  it('rejects path-traversal sequences', () => {
    expect(isValidSlug('../etc/hosts')).toBe(false);
    expect(isValidSlug('..')).toBe(false);
    expect(isValidSlug('a/../b')).toBe(false);
    expect(isValidSlug('a/b')).toBe(false);
    expect(isValidSlug('a\\b')).toBe(false);
  });

  it('rejects uppercase letters', () => {
    expect(isValidSlug('Goose-Hub')).toBe(false);
    expect(isValidSlug('PROJECT')).toBe(false);
  });

  it('rejects whitespace and unicode', () => {
    expect(isValidSlug('foo bar')).toBe(false);
    expect(isValidSlug('foo\tbar')).toBe(false);
    expect(isValidSlug('café')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidSlug('')).toBe(false);
  });

  it('rejects underscores, dots, and other punctuation', () => {
    expect(isValidSlug('foo_bar')).toBe(false);
    expect(isValidSlug('foo.bar')).toBe(false);
    expect(isValidSlug('foo:bar')).toBe(false);
  });

  it('rejects NUL byte', () => {
    expect(isValidSlug('foo\0bar')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getSourceForSlug — branch coverage
// ---------------------------------------------------------------------------

describe('getSourceForSlug', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('returns null when getProject returns null (unknown slug)', async () => {
    vi.doMock('./projects.js', () => ({
      getProject: vi.fn().mockResolvedValue(null),
    }));
    const { getSourceForSlug } = await import('./source.js');
    const result = await getSourceForSlug('unknown-slug');
    expect(result).toBeNull();
  });

  it('throws when source kind is unsupported', async () => {
    vi.doMock('./projects.js', () => ({
      getProject: vi.fn().mockResolvedValue({
        id: 'proj-1',
        name: 'Test',
        slug: 'test-slug',
        source: { kind: 'jira', repo: 'org/repo' },
      }),
    }));
    const { getSourceForSlug } = await import('./source.js');
    await expect(getSourceForSlug('test-slug')).rejects.toThrow('Unsupported source kind');
  });

  it('returns a LocalDbStateSource for local-db projects without requiring GITHUB_TOKEN', async () => {
    vi.doMock('./projects.js', () => ({
      getProject: vi.fn().mockResolvedValue({
        id: 'proj-local',
        name: 'Local',
        slug: 'local-project',
        source: { kind: 'local-db', stateMachine: 'db' },
        repos: ['org/local-repo'],
      }),
    }));
    const originalToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = '';
    const { getSourceForSlug } = await import('./source.js');
    try {
      const source = await getSourceForSlug('local-project');
      expect(source?.projectId).toBe('proj-local');
      expect(source?.repoRef).toBe('org/local-repo');
    } finally {
      process.env.GITHUB_TOKEN = originalToken;
    }
  });

  it('throws when GITHUB_TOKEN is an empty string (exercises the token guard)', async () => {
    // process.env values are always strings; empty string exercises `token.length === 0`.
    // The null/undefined path (token == null) cannot be reached via env var directly.
    vi.doMock('./projects.js', () => ({
      getProject: vi.fn().mockResolvedValue({
        id: 'proj-2',
        name: 'Test2',
        slug: 'my-project-token',
        source: { kind: 'github', repo: 'org/repo2' },
      }),
    }));
    const originalToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = '';
    const { getSourceForSlug } = await import('./source.js');
    try {
      await expect(getSourceForSlug('my-project-token')).rejects.toThrow('GITHUB_TOKEN');
    } finally {
      process.env.GITHUB_TOKEN = originalToken;
    }
  });

  it('returns a GitHubLabelsSource when config is valid and token is set', async () => {
    vi.doMock('./projects.js', () => ({
      getProject: vi.fn().mockResolvedValue({
        id: 'proj-3',
        name: 'My Project',
        slug: 'my-project-3',
        source: { kind: 'github', repo: 'org/my-repo' },
      }),
    }));
    const originalToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'test-token-xyz';
    const { getSourceForSlug } = await import('./source.js');
    try {
      const source = await getSourceForSlug('my-project-3');
      expect(source).not.toBeNull();
      expect(source?.projectId).toBe('proj-3');
      expect(source?.repoRef).toBe('org/my-repo');
    } finally {
      process.env.GITHUB_TOKEN = originalToken;
    }
  });

  it('returns cached source on second call without calling getProject again', async () => {
    const getProjectMock = vi.fn().mockResolvedValue({
      id: 'proj-4',
      name: 'Cached',
      slug: 'my-project-4',
      source: { kind: 'github', repo: 'org/cached-repo' },
    });
    vi.doMock('./projects.js', () => ({ getProject: getProjectMock }));
    const originalToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'test-token-cached';
    const { getSourceForSlug } = await import('./source.js');
    try {
      const first = await getSourceForSlug('my-project-4');
      const second = await getSourceForSlug('my-project-4');
      expect(first).toBe(second);
      expect(getProjectMock).toHaveBeenCalledOnce();
    } finally {
      process.env.GITHUB_TOKEN = originalToken;
    }
  });
});
