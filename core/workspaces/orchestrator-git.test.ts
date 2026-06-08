import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orchestratorCommitAll, wpWorktreePath } from './orchestrator-git.js';

let repo: string;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

describe('wpWorktreePath', () => {
  it('uses a path-delimiter-safe scratch worktree directory name', () => {
    const path = wpWorktreePath('run-123', 'WP1');

    expect(basename(path)).toBe('run-123__wp__WP1');
    expect(basename(path)).not.toContain(delimiter);
  });
});

describe('orchestratorCommitAll', () => {
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'orchestrator-commit-all-'));
    git(['init']);
    git(['config', 'user.name', 'Test User']);
    git(['config', 'user.email', 'test@example.com']);
    writeFileSync(join(repo, 'README.md'), 'initial\n');
    git(['add', 'README.md']);
    git(['commit', '-m', 'initial']);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('returns no-changes without creating an empty commit', () => {
    const before = git(['rev-parse', 'HEAD']);

    const result = orchestratorCommitAll(repo, 'repair');

    expect(result).toEqual({ status: 'no-changes' });
    expect(git(['rev-parse', 'HEAD'])).toBe(before);
  });

  it('commits staged changes and returns the commit sha', () => {
    writeFileSync(join(repo, 'README.md'), 'changed\n');

    const result = orchestratorCommitAll(repo, 'repair');

    expect(result.status).toBe('committed');
    if (result.status !== 'committed') return;
    expect(result.sha).toMatch(/^[a-f0-9]{40}$/);
    expect(git(['show', '--format=%s', '--no-patch', 'HEAD'])).toBe('repair');
  });

  it('does not commit .factory or .claude runtime artifacts', () => {
    writeFileSync(join(repo, 'README.md'), 'changed\n');
    mkdirSync(join(repo, '.factory'), { recursive: true });
    writeFileSync(join(repo, '.factory', 'symbol-index.db'), 'binary\n');
    mkdirSync(join(repo, '.claude'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'session.json'), '{}');

    const result = orchestratorCommitAll(repo, 'no-runtime-artifacts');

    expect(result.status).toBe('committed');
    if (result.status !== 'committed') return;
    const committedFiles = git(['show', '--name-only', '--format=', 'HEAD'])
      .split('\n')
      .filter(Boolean);
    expect(committedFiles).not.toContain('.factory/symbol-index.db');
    expect(committedFiles).not.toContain('.claude/session.json');
    expect(committedFiles).toContain('README.md');
  });
});
