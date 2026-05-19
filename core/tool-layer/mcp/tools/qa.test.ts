import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation } from '../path-policy.js';
import { PrDiffUnavailableError, getPrDiffTool, runIsolatedTestTool } from './qa.js';

let workspace: string;
let ctx: FactoryContext;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factory-qa-'));
  ctx = {
    runId: `run-${Math.random().toString(36).slice(2, 12)}`,
    projectId: 'demo',
    workItemId: 'github:demo/repo#1',
    workspaceRoot: workspace,
    serverPort: 3001,
  };
  execSync('git init -q', { cwd: workspace });
  writeFileSync(join(workspace, 'README.md'), 'one\n');
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('getPrDiffTool', () => {
  it('throws PrDiffUnavailableError when no local ref exists for the PR', async () => {
    await expect(getPrDiffTool(ctx, { prNumber: 9999 })).rejects.toBeInstanceOf(
      PrDiffUnavailableError,
    );
  });
});

describe('runIsolatedTestTool', () => {
  it('rejects parent-traversal paths', async () => {
    await expect(runIsolatedTestTool(ctx, { path: '../escape.test.ts' })).rejects.toBeInstanceOf(
      PathPolicyViolation,
    );
  });

  it('rejects assistant-home paths', async () => {
    await expect(
      runIsolatedTestTool(ctx, { path: '.claude/notes.test.ts' }),
    ).rejects.toBeInstanceOf(PathPolicyViolation);
  });
});
