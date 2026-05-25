import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orchestratorCommitAll } from './orchestrator-git.js';

let repo: string;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

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
});
