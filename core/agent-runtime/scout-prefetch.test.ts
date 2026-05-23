import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RepoRelativePath } from '../tool-layer/path-contract.js';
import { gitRecentChanges } from './git-intel.js';
import { buildInvestigationSeed } from './scout-prefetch.js';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'investigation-seed-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('buildInvestigationSeed', () => {
  it('returns deterministic seed content when helpers and clock are deterministic', async () => {
    const now = () => new Date('2026-05-23T00:00:00Z');
    const seed = await buildInvestigationSeed(
      { title: 'Fix AuthService', body: 'AuthService fails', externalId: 42 },
      { id: 'demo', worktreePath: workspace },
      {
        now,
        lookupSymbols: () => [
          { name: 'AuthService', definedIn: 'src/auth.ts', line: 3, kind: 'class', callers: [] },
        ],
        recentChanges: async () => [],
        priorInvestigationIds: () => [],
      },
    );
    const again = await buildInvestigationSeed(
      { title: 'Fix AuthService', body: 'AuthService fails', externalId: 42 },
      { id: 'demo', worktreePath: workspace },
      {
        now,
        lookupSymbols: () => [
          { name: 'AuthService', definedIn: 'src/auth.ts', line: 3, kind: 'class', callers: [] },
        ],
        recentChanges: async () => [],
        priorInvestigationIds: () => [],
      },
    );

    expect(again).toEqual(seed);
    expect(seed.candidateFiles).toEqual([{ path: 'src/auth.ts', root: 'worktree' }]);
    expect(seed.candidateSymbols).toHaveLength(1);
  });

  it('returns an empty but typed seed for an empty repo', async () => {
    const seed = await buildInvestigationSeed(
      { title: 'Plain prose', body: 'nothing code-like' },
      { worktreePath: workspace },
      { lookupSymbols: () => [], recentChanges: async () => [], priorInvestigationIds: () => [] },
    );

    expect(seed.candidateFiles).toEqual([]);
    expect(seed.candidateSymbols).toEqual([]);
    expect(seed.testFiles).toEqual([]);
    expect(seed.recentlyChangedFiles).toEqual([]);
    expect(seed.priorInvestigationRunIds).toEqual([]);
    expect(seed.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('includes prior overlapping investigation ids from the seed files', async () => {
    const seed = await buildInvestigationSeed(
      { title: 'Fix AuthService', body: 'AuthService fails' },
      { id: 'demo', worktreePath: workspace },
      {
        lookupSymbols: () => [
          { name: 'AuthService', definedIn: 'src/auth.ts', line: 3, kind: 'class', callers: [] },
        ],
        recentChanges: async () => [],
        priorInvestigationIds: ({ candidateFiles }) =>
          candidateFiles.some((file) => file.path === 'src/auth.ts') ? ['prior-run-1'] : [],
      },
    );

    expect(seed.priorInvestigationRunIds).toEqual(['prior-run-1']);
  });
});

describe('gitRecentChanges', () => {
  it('caps recently changed candidate files at 15', async () => {
    execFileSync('git', ['init', '-q'], { cwd: workspace });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: workspace });
    mkdirSync(join(workspace, 'src'));
    const candidates: RepoRelativePath[] = [];
    for (let index = 0; index < 20; index += 1) {
      const path = `src/file-${index}.ts`;
      writeFileSync(join(workspace, path), `export const n${index} = ${index};\n`);
      candidates.push({ path, root: 'worktree' });
    }
    execFileSync('git', ['add', 'src'], { cwd: workspace });
    execFileSync('git', ['commit', '-q', '-m', 'seed files'], { cwd: workspace });

    const recent = await gitRecentChanges({ worktreePath: workspace, candidateFiles: candidates });

    expect(recent).toHaveLength(15);
    expect(recent[0]).toMatchObject({ path: { root: 'worktree' } });
  });
});
