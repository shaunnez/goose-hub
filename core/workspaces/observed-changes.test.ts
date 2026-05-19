import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GIT_ENV } from './git-env.js';
import { deriveObservedChangedFiles } from './observed-changes.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
}

function write(worktreePath: string, path: string, content = ''): void {
  const absPath = join(worktreePath, path);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content);
}

function makeRepo(): string {
  const worktreePath = mkdtempSync(join(tmpdir(), 'goose-hub-observed-changes-'));
  git(worktreePath, ['init', '-q']);
  git(worktreePath, ['config', 'user.email', 'factory@example.test']);
  git(worktreePath, ['config', 'user.name', 'Factory Test']);
  return worktreePath;
}

describe('deriveObservedChangedFiles', () => {
  it('builds a normalized changed-file packet from git diff and status', () => {
    const worktreePath = makeRepo();
    write(worktreePath, 'core/existing.ts', 'before\n');
    write(worktreePath, 'core/delete-me.ts', 'delete\n');
    git(worktreePath, ['add', '.']);
    git(worktreePath, ['commit', '-m', 'initial']);

    write(worktreePath, 'core/existing.ts', 'after\n');
    write(worktreePath, 'core/staged.ts', 'staged\n');
    git(worktreePath, ['add', 'core/staged.ts']);
    git(worktreePath, ['rm', '-q', 'core/delete-me.ts']);
    write(worktreePath, 'apps/web/src/new-view.tsx', 'untracked\n');

    const packet = deriveObservedChangedFiles(worktreePath);

    expect(packet.gitAvailable).toBe(true);
    expect(packet.paths).toEqual([
      'core/existing.ts',
      'core/delete-me.ts',
      'core/staged.ts',
      'apps/web/src/new-view.tsx',
    ]);
    expect(packet.count).toBe(4);
    expect(packet.files).toContainEqual(
      expect.objectContaining({
        path: 'core/existing.ts',
        rawPath: 'core/existing.ts',
        status: 'modified',
        sources: ['git-diff', 'git-status'],
      }),
    );
    expect(packet.files).toContainEqual(
      expect.objectContaining({
        path: 'core/delete-me.ts',
        status: 'deleted',
        sources: ['git-diff-cached', 'git-status'],
      }),
    );
    expect(packet.files).toContainEqual(
      expect.objectContaining({
        path: 'core/staged.ts',
        status: 'added',
        sources: ['git-diff-cached', 'git-status'],
      }),
    );
    expect(packet.files).toContainEqual(
      expect.objectContaining({
        path: 'apps/web/src/new-view.tsx',
        status: 'untracked',
        sources: ['git-status'],
      }),
    );
  });

  it('returns an empty unavailable packet outside a git worktree', () => {
    const worktreePath = mkdtempSync(join(tmpdir(), 'goose-hub-not-git-'));
    write(worktreePath, 'core/file.ts', 'x\n');

    expect(deriveObservedChangedFiles(worktreePath)).toEqual({
      count: 0,
      paths: [],
      files: [],
      gitAvailable: false,
    });
  });
});
