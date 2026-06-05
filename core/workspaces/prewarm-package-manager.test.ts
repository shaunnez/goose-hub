import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type WorktreeDependencyPreflightError, prewarmWorktree } from './worktree.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'prewarm-pm-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const packageJson = (packageManager?: string) =>
  JSON.stringify({
    ...(packageManager != null ? { packageManager } : {}),
    scripts: { test: 'vitest' },
  });

describe('prewarmWorktree package manager selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(''));
  });

  it('runs npm ci for npm lockfile repos', async () => {
    const dir = repo({ 'package.json': packageJson(), 'package-lock.json': '{}' });

    await prewarmWorktree(dir);

    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'npm',
      ['ci'],
      expect.objectContaining({ cwd: dir, stdio: 'pipe' }),
    );
  });

  it('runs pnpm install --frozen-lockfile for pnpm repos', async () => {
    const dir = repo({ 'package.json': packageJson(), 'pnpm-lock.yaml': 'lockfileVersion: 9\n' });

    await prewarmWorktree(dir);

    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'pnpm',
      ['install', '--frozen-lockfile'],
      expect.objectContaining({ cwd: dir, stdio: 'pipe' }),
    );
  });

  it('runs yarn install for yarn repos', async () => {
    const dir = repo({ 'package.json': packageJson(), 'yarn.lock': '' });

    await prewarmWorktree(dir);

    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'yarn',
      ['install', '--frozen-lockfile'],
      expect.objectContaining({ cwd: dir, stdio: 'pipe' }),
    );
  });

  it('wraps failed installs with command, cwd, exit code, package manager, and stderr', async () => {
    const dir = repo({ 'package.json': packageJson(), 'package-lock.json': '{}' });
    vi.mocked(execFileSync).mockImplementation(() => {
      const err = new Error('npm failed') as Error & { status: number; stderr: Buffer };
      err.status = 1;
      err.stderr = Buffer.from('first line\nlast line\n');
      throw err;
    });

    await expect(prewarmWorktree(dir)).rejects.toMatchObject({
      name: 'WorktreeDependencyPreflightError',
      command: ['npm', 'ci'],
      cwd: dir,
      packageManager: 'npm',
      exitCode: 1,
      stderrTail: 'first line\nlast line',
    } satisfies Partial<WorktreeDependencyPreflightError>);
  });
});
