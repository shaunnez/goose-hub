import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation } from '../path-policy.js';
import {
  GitCommandError,
  getBlameTool,
  getChangedFilesTool,
  getDiffTool,
  getHeadShaTool,
  getLogTool,
  getMergeBaseTool,
  getStatusTool,
} from './git.js';

let workspace: string;
let ctx: FactoryContext;

function git(args: string): void {
  execSync(`git ${args}`, { cwd: workspace, stdio: 'pipe' });
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factory-git-'));
  ctx = {
    runId: `run-${Math.random().toString(36).slice(2, 12)}`,
    projectId: 'demo',
    workItemId: 'github:demo/repo#1',
    workspaceRoot: workspace,
    serverPort: 3001,
  };
  git('init -q -b main');
  // Stage an initial blob via `git update-index --add` + `git write-tree`
  // so we get an HEAD without needing `git commit` (which is blocked in
  // some sandboxed environments by a commit-signing hook).
  writeFileSync(join(workspace, 'README.md'), 'one\n');
  git('add README.md');
  const tree = execSync('git write-tree', { cwd: workspace }).toString().trim();
  const commit = execSync(`git commit-tree ${tree} -m init`, {
    cwd: workspace,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  })
    .toString()
    .trim();
  git(`update-ref HEAD ${commit}`);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('getStatusTool', () => {
  it('returns clean status on a fresh repo', async () => {
    const result = await getStatusTool(ctx);
    expect(result.branch).toBe('main');
    expect(result.clean).toBe(true);
    expect(result.entries).toEqual([]);
  });

  it('surfaces an untracked file', async () => {
    writeFileSync(join(workspace, 'new.txt'), 'x');
    const result = await getStatusTool(ctx);
    expect(result.clean).toBe(false);
    expect(result.entries.some((e) => e.path.path === 'new.txt' && e.status === 'untracked')).toBe(
      true,
    );
  });

  it('surfaces a modified-but-unstaged change', async () => {
    writeFileSync(join(workspace, 'README.md'), 'two\n');
    const result = await getStatusTool(ctx);
    const entry = result.entries.find((e) => e.path.path === 'README.md');
    expect(entry?.status).toBe('modified');
    expect(entry?.staged).toBe(false);
  });

  it('flags staged changes as staged=true', async () => {
    writeFileSync(join(workspace, 'README.md'), 'staged\n');
    git('add README.md');
    const result = await getStatusTool(ctx);
    const entry = result.entries.find((e) => e.path.path === 'README.md');
    expect(entry?.staged).toBe(true);
  });
});

describe('getChangedFilesTool', () => {
  it('returns a flat list of paths', async () => {
    writeFileSync(join(workspace, 'a.txt'), 'a');
    writeFileSync(join(workspace, 'b.txt'), 'b');
    const result = await getChangedFilesTool(ctx);
    expect(result.files.map((f) => f.path).sort()).toEqual(['a.txt', 'b.txt']);
  });
});

describe('getDiffTool', () => {
  it('returns the unstaged diff by default', async () => {
    writeFileSync(join(workspace, 'README.md'), 'changed\n');
    const result = await getDiffTool(ctx, {});
    expect(result.diff).toContain('-one');
    expect(result.diff).toContain('+changed');
    expect(result.staged).toBe(false);
  });

  it('returns the staged diff when requested', async () => {
    writeFileSync(join(workspace, 'README.md'), 'staged-change\n');
    git('add README.md');
    const result = await getDiffTool(ctx, { staged: true });
    expect(result.diff).toContain('+staged-change');
    expect(result.staged).toBe(true);
  });
});

describe('getHeadShaTool', () => {
  it('returns a 40-char hex sha', async () => {
    const result = await getHeadShaTool(ctx);
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('getMergeBaseTool', () => {
  it('returns base=null when ref does not exist', async () => {
    const result = await getMergeBaseTool(ctx, { ref: 'no-such-ref' });
    expect(result.base).toBeNull();
    expect(result.ref).toBe('no-such-ref');
  });
});

describe('GitCommandError', () => {
  it('throws GitCommandError when not in a git repo', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'factory-not-git-'));
    const outsideCtx = { ...ctx, workspaceRoot: outside };
    try {
      await expect(getHeadShaTool(outsideCtx)).rejects.toBeInstanceOf(GitCommandError);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('getLogTool', () => {
  it('returns a structured commit list for the HEAD ref', async () => {
    const result = await getLogTool(ctx, { limit: 5 });
    expect(result.commits.length).toBeGreaterThan(0);
    const first = result.commits[0];
    expect(first.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(first.subject).toBe('init');
    expect(first.authorName).toBe('Test');
  });

  it('rejects parent-traversal paths', async () => {
    await expect(getLogTool(ctx, { path: '../escape.txt' })).rejects.toBeInstanceOf(
      PathPolicyViolation,
    );
  });
});

describe('getBlameTool', () => {
  it('rejects assistant-home paths', async () => {
    await expect(getBlameTool(ctx, { path: '.codex/auth.json' })).rejects.toBeInstanceOf(
      PathPolicyViolation,
    );
  });
});
