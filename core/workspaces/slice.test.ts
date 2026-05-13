import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupWorktree, createWorktree, parseCloneUrl } from './worktree.js';

const WT = (runId: string) => join('/mock-home', '.factory', 'workspaces', runId);
const WORKSPACES_DIR = join('/mock-home', '.factory', 'workspaces');

// ─── module mocks (hoisted by vitest) ────────────────────────────────────────
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));
vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  rmSync: vi.fn(),
}));
vi.mock('node:os', () => ({ homedir: vi.fn().mockReturnValue('/mock-home') }));

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';

describe('createWorktree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mkdirSync).mockReturnValue(undefined);
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(''));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates the parent directory before calling git worktree add', () => {
    createWorktree('/repo/path', 'run-abc-123');

    expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith(WORKSPACES_DIR, {
      recursive: true,
    });
  });

  it('calls git worktree add with the correct path and detach flag', () => {
    createWorktree('/repo/path', 'run-abc-123');

    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'git',
      ['worktree', 'add', '--detach', WT('run-abc-123')],
      expect.objectContaining({ cwd: '/repo/path' }),
    );
  });

  it('returns the worktree path', () => {
    const result = createWorktree('/repo/path', 'run-abc-123');
    expect(result).toBe(WT('run-abc-123'));
  });

  it('propagates errors from git worktree add', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('git worktree add failed');
    });
    expect(() => createWorktree('/repo/path', 'run-abc-123')).toThrow('git worktree add failed');
  });
});

describe('cleanupWorktree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(''));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls git worktree remove --force when path exists', () => {
    vi.mocked(existsSync).mockReturnValue(true);

    cleanupWorktree('run-abc-123');

    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'git',
      ['worktree', 'remove', '--force', WT('run-abc-123')],
      expect.any(Object),
    );
  });

  it('removes the directory after git worktree remove', () => {
    vi.mocked(existsSync).mockReturnValue(true);

    cleanupWorktree('run-abc-123');

    expect(vi.mocked(rmSync)).toHaveBeenCalledWith(WT('run-abc-123'), {
      recursive: true,
      force: true,
    });
  });

  it('is idempotent — does not throw when path does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() => cleanupWorktree('run-abc-123')).not.toThrow();
    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
    expect(vi.mocked(rmSync)).not.toHaveBeenCalled();
  });

  it('is idempotent — does not throw on second call when path is gone', () => {
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(false);

    // First call: exists, removes it
    cleanupWorktree('run-abc-123');
    // Second call: already gone, no-op
    expect(() => cleanupWorktree('run-abc-123')).not.toThrow();
  });

  it('is idempotent — does not throw when git worktree remove fails (already removed)', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('fatal: not a git repository');
    });

    // Should still not throw — git error is swallowed, rmSync with force cleans up
    expect(() => cleanupWorktree('run-abc-123')).not.toThrow();
    expect(vi.mocked(rmSync)).toHaveBeenCalledWith(WT('run-abc-123'), {
      recursive: true,
      force: true,
    });
  });
});

describe('parseCloneUrl (M14.07 / #328)', () => {
  it('parses Bitbucket SSH URLs', () => {
    expect(parseCloneUrl('git@bitbucket.org:team/payments-api.git')).toEqual({
      scheme: 'ssh',
      host: 'bitbucket.org',
      workspace: 'team',
      repoSlug: 'payments-api',
      isBitbucket: true,
    });
  });

  it('parses Bitbucket HTTPS URLs', () => {
    expect(parseCloneUrl('https://bitbucket.org/team/payments-api.git')).toEqual({
      scheme: 'https',
      host: 'bitbucket.org',
      workspace: 'team',
      repoSlug: 'payments-api',
      isBitbucket: true,
    });
  });

  it('flags GitHub SSH URLs but is not Bitbucket', () => {
    expect(parseCloneUrl('git@github.com:shaunnez/goose-hub.git')).toEqual({
      scheme: 'ssh',
      host: 'github.com',
      workspace: 'shaunnez',
      repoSlug: 'goose-hub',
      isBitbucket: false,
    });
  });

  it('returns null for non-URL inputs', () => {
    expect(parseCloneUrl('/local/path/to/repo')).toBeNull();
    expect(parseCloneUrl('not a url')).toBeNull();
  });
});

describe('createWorktree with clone URL (M14.07 / #328)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mkdirSync).mockReturnValue(undefined);
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(''));
    vi.mocked(existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clones a Bitbucket SSH URL and adds the worktree from the local clone', () => {
    createWorktree('git@bitbucket.org:team/payments-api.git', 'run-ssh-1');

    const calls = vi.mocked(execFileSync).mock.calls;
    // First call: git clone
    expect(calls[0][0]).toBe('git');
    expect(calls[0][1]).toEqual([
      'clone',
      'git@bitbucket.org:team/payments-api.git',
      '/mock-home/.factory/clones/bitbucket.org/team/payments-api',
    ]);
    // Second call: git worktree add, cwd = the local clone path
    expect(calls[1][0]).toBe('git');
    expect(calls[1][1]).toEqual(['worktree', 'add', '--detach', WT('run-ssh-1')]);
    expect((calls[1][2] as { cwd: string }).cwd).toBe(
      '/mock-home/.factory/clones/bitbucket.org/team/payments-api',
    );
  });

  it('injects BITBUCKET_APP_PASSWORD into Bitbucket HTTPS URLs', () => {
    const saved = {
      user: process.env.BITBUCKET_USER,
      pw: process.env.BITBUCKET_APP_PASSWORD,
    };
    process.env.BITBUCKET_USER = 'bot@example.com';
    process.env.BITBUCKET_APP_PASSWORD = 'pw-xyz';
    try {
      createWorktree('https://bitbucket.org/team/payments-api.git', 'run-https-1');

      const cloneCall = vi.mocked(execFileSync).mock.calls.find((c) => c[1]?.[0] === 'clone');
      expect(cloneCall).toBeDefined();
      const url = cloneCall?.[1]?.[1] ?? '';
      expect(url).toContain('bot%40example.com:pw-xyz');
      expect(url).toContain('bitbucket.org/team/payments-api.git');
    } finally {
      // biome-ignore lint/performance/noDelete: env restore for test isolation
      if (saved.user === undefined) delete process.env.BITBUCKET_USER;
      else process.env.BITBUCKET_USER = saved.user;
      // biome-ignore lint/performance/noDelete: env restore for test isolation
      if (saved.pw === undefined) delete process.env.BITBUCKET_APP_PASSWORD;
      else process.env.BITBUCKET_APP_PASSWORD = saved.pw;
    }
  });

  it('reuses an existing clone instead of re-cloning', () => {
    vi.mocked(existsSync).mockReturnValue(true);

    createWorktree('git@bitbucket.org:team/payments-api.git', 'run-cache-1');

    const cloneCall = vi.mocked(execFileSync).mock.calls.find((c) => c[1]?.[0] === 'clone');
    expect(cloneCall).toBeUndefined();
    const wtCall = vi.mocked(execFileSync).mock.calls.find((c) => c[1]?.[0] === 'worktree');
    expect(wtCall).toBeDefined();
  });

  it('propagates clone failures (bad credentials)', () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error('Authentication failed for https://bitbucket.org/team/repo.git');
    });
    expect(() =>
      createWorktree('https://bitbucket.org/team/payments-api.git', 'run-fail-1'),
    ).toThrow(/Authentication failed/);
  });

  it('still accepts a plain local path (backward compatible)', () => {
    createWorktree('/local/repo/path', 'run-local-1');
    const calls = vi.mocked(execFileSync).mock.calls;
    // Should NOT have called git clone — only worktree add.
    expect(calls.find((c) => c[1]?.[0] === 'clone')).toBeUndefined();
    expect(calls.some((c) => c[1]?.[0] === 'worktree')).toBe(true);
  });
});
