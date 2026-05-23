import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventStore } from '../../../event-stream/store.js';
import type { FactoryContext } from '../context.js';
import { PathPolicyViolation } from '../path-policy.js';
import { type RepoIntelDeps, type RepoIntelQuery, repoIntelQueryTool } from './repo-intel.js';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'repo-intel-'));
  mkdirSync(join(workspace, 'src'));
  writeFileSync(join(workspace, 'src', 'auth.ts'), 'export function AuthService() {}\n');
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function makeCtx(overrides: Partial<FactoryContext> = {}): FactoryContext {
  return {
    runId: `repo-intel-${Math.random().toString(36).slice(2, 10)}`,
    projectId: 'demo',
    workItemId: 'github:demo/repo#42',
    workspaceRoot: workspace,
    serverPort: 3001,
    ...overrides,
  };
}

describe('repoIntelQueryTool', () => {
  it.each([
    [
      'find-symbol',
      { intent: 'find-symbol', name: 'AuthService', kind: 'function' },
      {
        lookupSymbol: vi.fn(() => [
          {
            name: 'AuthService',
            kind: 'function' as const,
            filePath: 'src/auth.ts',
            line: 1,
            exported: true,
          },
        ]),
      },
    ],
    [
      'find-callers',
      { intent: 'find-callers', symbol: 'AuthService' },
      { findCallersOfSymbol: vi.fn(() => ['src/login.ts']) },
    ],
    [
      'find-tests-for',
      { intent: 'find-tests-for', target: 'src/auth.ts' },
      {
        buildRelatedSurfaceManifest: vi.fn(() => ({
          keyFiles: [{ path: 'src/auth.ts' }],
          packageRoots: [],
          existingTests: ['src/auth.test.ts'],
          testCandidates: [],
          evidenceSpecPath: null,
          checkedAbsent: [],
          targetedTestPaths: ['src/auth.test.ts'],
          readFirst: [],
          primaryTestPath: 'src/auth.test.ts',
          testMode: 'update-existing',
          doNotSearchFor: [],
        })),
      },
    ],
    [
      'related-files',
      { intent: 'related-files', target: 'src/auth.ts' },
      {
        buildRelatedSurfaceManifest: vi.fn(() => ({
          keyFiles: [{ path: 'src/auth.ts' }],
          packageRoots: ['src'],
          existingTests: [],
          testCandidates: ['src/auth.test.ts'],
          evidenceSpecPath: null,
          checkedAbsent: ['src/auth.test.ts'],
          targetedTestPaths: ['src/auth.test.ts'],
          readFirst: ['src/auth.ts'],
          primaryTestPath: 'src/auth.test.ts',
          testMode: 'create-candidate',
          doNotSearchFor: ['src/auth.test.ts'],
        })),
      },
    ],
    [
      'recent-changes',
      { intent: 'recent-changes', path: 'src/auth.ts', sinceDays: 7 },
      {
        gitRecentChanges: vi.fn(async () => [
          {
            path: { path: 'src/auth.ts', root: 'worktree' },
            lastTouched: '2026-05-23T00:00:00Z',
            lastCommitSha: 'abc1234',
          },
        ]),
      },
    ],
    [
      'prior-investigation',
      { intent: 'prior-investigation', workItemId: 'github:demo/repo#41' },
      {
        latestInvestigationContext: vi.fn(() => ({
          keyFiles: [{ path: 'src/auth.ts' }],
          openQuestions: [],
          investigationRunId: 'investigation-run-1',
        })),
        listScoutReportsForInvestigation: vi.fn(() => [
          {
            id: 1,
            projectId: 'demo',
            workItemId: 'github:demo/repo#41',
            investigationRunId: 'investigation-run-1',
            scoutSkill: 'scout-code-path',
            report: { findings: [{ file: 'src/auth.ts', fact: 'AuthService is exported' }] },
            createdAt: '2026-05-23T00:00:00Z',
          },
        ]),
      },
    ],
    [
      'fetch-artifact',
      { intent: 'fetch-artifact', artifactKey: 'scout-report:abc' },
      {
        getArtifact: vi.fn(() => ({
          id: 1,
          artifactKey: 'scout-report:abc',
          projectId: 'demo',
          workItemId: 'github:demo/repo#41',
          runId: 'run-1',
          kind: 'scout-report',
          summary: 'stored scout report',
          payload: { findings: [] },
          bytes: 42,
          createdAt: '2026-05-23T00:00:00Z',
          expiresAt: null,
        })),
      },
    ],
  ])('returns results for %s', async (_name, query, deps) => {
    const result = await repoIntelQueryTool(
      makeCtx(),
      query as RepoIntelQuery,
      deps as RepoIntelDeps,
    );

    expect(result).toMatchObject({ ok: true, intent: query.intent });
    if (result.ok) expect(result.results.length).toBeGreaterThan(0);
  });

  it.each([
    ['find-symbol', { intent: 'find-symbol', name: 'Missing' }, { lookupSymbol: vi.fn(() => []) }],
    [
      'find-callers',
      { intent: 'find-callers', symbol: 'Missing' },
      { findCallersOfSymbol: vi.fn(() => []) },
    ],
    [
      'find-tests-for',
      { intent: 'find-tests-for', target: 'src/auth.ts' },
      { buildRelatedSurfaceManifest: vi.fn(() => undefined) },
    ],
    [
      'related-files',
      { intent: 'related-files', target: 'src/auth.ts' },
      { buildRelatedSurfaceManifest: vi.fn(() => undefined) },
    ],
    [
      'recent-changes',
      { intent: 'recent-changes', path: 'src/auth.ts' },
      { gitRecentChanges: vi.fn(async () => []) },
    ],
    [
      'prior-investigation',
      { intent: 'prior-investigation', workItemId: 'github:demo/repo#41' },
      { latestInvestigationContext: vi.fn(() => undefined) },
    ],
    [
      'fetch-artifact',
      { intent: 'fetch-artifact', artifactKey: 'missing' },
      { getArtifact: vi.fn(() => null) },
    ],
  ])('returns not-found for %s', async (_name, query, deps) => {
    const result = await repoIntelQueryTool(
      makeCtx(),
      query as RepoIntelQuery,
      deps as RepoIntelDeps,
    );

    expect(result).toMatchObject({ ok: false, intent: query.intent, reason: 'not-found' });
  });

  it('caches by normalized query and audits repo_intel_intent', async () => {
    const ctx = makeCtx({ runId: 'repo-intel-cache' });
    const lookup = vi.fn(() => [
      {
        name: 'AuthService',
        kind: 'function' as const,
        filePath: 'src/auth.ts',
        line: 1,
        exported: true,
      },
    ]);

    await repoIntelQueryTool(
      ctx,
      { intent: 'find-symbol', name: 'AuthService' },
      { lookupSymbol: lookup },
    );
    const second = await repoIntelQueryTool(
      ctx,
      { intent: 'find-symbol', name: 'AuthService' },
      { lookupSymbol: lookup },
    );

    expect(second).toMatchObject({ ok: true, cached: true });
    expect(lookup).toHaveBeenCalledTimes(1);
    const events = eventStore.replay({ runId: ctx.runId, kind: 'agent.tool-call' });
    expect(events[0].payload).toMatchObject({
      tool_name: 'repo_intel.query',
      repo_intel_intent: 'find-symbol',
    });
    expect(events[1].payload).toMatchObject({ cached: true });
  });

  it('applies path policy to path-bearing inputs', async () => {
    await expect(
      repoIntelQueryTool(makeCtx(), { intent: 'related-files', target: '../escape.ts' }),
    ).rejects.toBeInstanceOf(PathPolicyViolation);
  });
});
