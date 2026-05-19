import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation } from '../path-policy.js';
import { GitMutationError, stageChangesTool } from './workflow.js';

let workspace: string;
let ctx: FactoryContext;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factory-workflow-'));
  ctx = {
    runId: `run-${Math.random().toString(36).slice(2, 12)}`,
    projectId: 'demo',
    workItemId: 'github:demo/repo#1',
    workspaceRoot: workspace,
    serverPort: 3001,
  };
  execSync('git init -q', { cwd: workspace });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('stageChangesTool', () => {
  it('stages explicit paths', async () => {
    writeFileSync(join(workspace, 'a.txt'), 'a');
    writeFileSync(join(workspace, 'b.txt'), 'b');
    const result = await stageChangesTool(ctx, { paths: ['a.txt'] });
    expect(result.staged).toEqual(['a.txt']);

    // verify staged state via porcelain
    const status = execSync('git status --porcelain', { cwd: workspace }).toString();
    expect(status).toContain('A  a.txt');
    expect(status).toContain('?? b.txt');
  });

  it('stages everything when no paths are supplied', async () => {
    writeFileSync(join(workspace, 'a.txt'), 'a');
    writeFileSync(join(workspace, 'b.txt'), 'b');
    await stageChangesTool(ctx, {});

    const status = execSync('git status --porcelain', { cwd: workspace }).toString();
    expect(status).toContain('A  a.txt');
    expect(status).toContain('A  b.txt');
  });

  it('rejects assistant-home paths before invoking git', async () => {
    await expect(stageChangesTool(ctx, { paths: ['.codex/auth.json'] })).rejects.toBeInstanceOf(
      PathPolicyViolation,
    );
  });

  it('throws GitMutationError when no git repo is present', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'factory-no-git-'));
    const outsideCtx = { ...ctx, workspaceRoot: outside };
    try {
      writeFileSync(join(outside, 'a.txt'), 'a');
      await expect(stageChangesTool(outsideCtx, { paths: ['a.txt'] })).rejects.toBeInstanceOf(
        GitMutationError,
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

// commitChangesTool is exercised end-to-end by the orchestrator integration
// suite, not here — `git commit` requires signing config that the local
// sandbox blocks. Path policy and argv shape are covered by stageChanges
// since the same path/policy helpers are shared.
