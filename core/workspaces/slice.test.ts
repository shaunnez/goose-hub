import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupWorktree, createWorktree, resolveWorkflowBase } from './worktree.js';

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

  it('uses an explicit base ref when provided', () => {
    createWorktree('/repo/path', 'run-abc-123', 'origin/main');

    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'git',
      ['worktree', 'add', '--detach', WT('run-abc-123'), 'origin/main'],
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

describe('resolveWorkflowBase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers the currently checked-out branch', () => {
    vi.mocked(execFileSync).mockReturnValue('feature/current\n');

    expect(resolveWorkflowBase('/repo/path', 'main')).toEqual({
      branch: 'feature/current',
      ref: 'feature/current',
      source: 'current-branch',
    });
  });

  it('falls back to the configured default branch as a remote ref', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('detached');
    });

    expect(resolveWorkflowBase('/repo/path', 'develop')).toEqual({
      branch: 'develop',
      ref: 'origin/develop',
      source: 'configured-default',
    });
  });

  it('normalizes origin-prefixed configured default branches for PR metadata', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('detached');
    });

    expect(resolveWorkflowBase('/repo/path', 'origin/release')).toEqual({
      branch: 'release',
      ref: 'origin/release',
      source: 'configured-default',
    });
  });

  it('falls back to origin/main when no branch can be resolved', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('detached');
    });

    expect(resolveWorkflowBase('/repo/path')).toEqual({
      branch: 'main',
      ref: 'origin/main',
      source: 'fallback-main',
    });
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
