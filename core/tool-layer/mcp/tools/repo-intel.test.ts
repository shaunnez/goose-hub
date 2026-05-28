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
      'find-calls-of',
      { intent: 'find-calls-of', symbol: 'AuthService' },
      {
        findCallsOf: vi.fn(() => [{ path: 'src/auth.ts', line: 1, symbol: 'AuthService' }]),
      },
    ],
    [
      'find-jsx-usages',
      { intent: 'find-jsx-usages', component: 'Button', withProp: { name: 'variant' } },
      {
        findJsxUsages: vi.fn(() => [{ path: 'src/button.tsx', line: 3, symbol: 'Button' }]),
      },
    ],
    [
      'find-importers',
      { intent: 'find-importers', module: '@/lib/api', symbol: 'api' },
      {
        findImportersImporting: vi.fn(() => [{ path: 'src/app.ts', line: 1, symbol: 'api' }]),
      },
    ],
    [
      'find-route',
      { intent: 'find-route', pathPattern: '/projects/:slug' },
      {
        lookupRoute: vi.fn(() => [
          {
            pathPattern: '/projects/:slug',
            filePath: 'apps/web/src/App.tsx',
            line: 12,
            component: 'ProjectPage',
          },
        ]),
      },
    ],
    [
      'find-component',
      { intent: 'find-component', component: 'Button' },
      {
        findComponentUsages: vi.fn(() => [
          { component: 'Button', filePath: 'apps/web/src/App.tsx', line: 8 },
        ]),
      },
    ],
    [
      'route-for-component',
      { intent: 'route-for-component', component: 'ProjectPage' },
      {
        routeForComponent: vi.fn(() => [
          {
            pathPattern: '/projects/:slug',
            filePath: 'apps/web/src/App.tsx',
            line: 12,
            component: 'ProjectPage',
          },
        ]),
      },
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
      'find-calls-of',
      { intent: 'find-calls-of', symbol: 'Missing' },
      { findCallsOf: vi.fn(() => []) },
    ],
    [
      'find-jsx-usages',
      { intent: 'find-jsx-usages', component: 'Missing' },
      { findJsxUsages: vi.fn(() => []) },
    ],
    [
      'find-importers',
      { intent: 'find-importers', module: '@/lib/api', symbol: 'missing' },
      { findImportersImporting: vi.fn(() => []) },
    ],
    [
      'find-route',
      { intent: 'find-route', pathPattern: '/missing' },
      { lookupRoute: vi.fn(() => []) },
    ],
    [
      'find-component',
      { intent: 'find-component', component: 'Missing' },
      { findComponentUsages: vi.fn(() => []) },
    ],
    [
      'route-for-component',
      { intent: 'route-for-component', component: 'Missing' },
      { routeForComponent: vi.fn(() => []) },
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

  it('returns index-stale when an AST or route helper fails', async () => {
    const result = await repoIntelQueryTool(
      makeCtx(),
      { intent: 'find-calls-of', symbol: 'AuthService' },
      { findCallsOf: vi.fn(() => null) },
    );

    expect(result).toMatchObject({
      ok: false,
      intent: 'find-calls-of',
      reason: 'index-stale',
      fallbackHint: expect.stringContaining('search_text'),
    });
  });

  it.each([
    ['find-symbol', 'name'],
    ['find-route', 'pathPattern'],
    ['find-callers', 'symbol'],
    ['find-calls-of', 'symbol'],
    ['find-jsx-usages', 'component'],
    ['find-component', 'component'],
    ['find-tests-for', 'target'],
    ['related-files', 'target'],
    ['fetch-artifact', 'artifactKey'],
    ['route-for-url', 'url'],
  ])(
    'returns invalid-args with field-specific hint when %s missing %s',
    async (intent, missingField) => {
      const result = await repoIntelQueryTool(makeCtx(), {
        intent,
      } as unknown as RepoIntelQuery);

      expect(result).toMatchObject({
        ok: false,
        intent,
        reason: 'invalid-args',
      });
      if (!result.ok && result.reason === 'invalid-args') {
        expect(result.fallbackHint).toContain(missingField);
      }
    },
  );

  it('audit event carries inputKeys for invalid-args calls', async () => {
    const ctx = makeCtx({ runId: 'repo-intel-audit-invalid' });
    await repoIntelQueryTool(ctx, { intent: 'find-symbol' } as unknown as RepoIntelQuery);
    const events = eventStore.replay({ runId: ctx.runId, kind: 'agent.tool-call' });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].payload).toMatchObject({
      tool_name: 'repo_intel.query',
      repo_intel_intent: 'find-symbol',
      status: 'failed',
      inputKeys: ['intent'],
    });
  });

  it('audits not-found as ok with noMatches while invalid-args remains failed', async () => {
    const notFoundCtx = makeCtx({ runId: 'repo-intel-audit-not-found' });
    await repoIntelQueryTool(
      notFoundCtx,
      { intent: 'find-symbol', name: 'Missing' },
      { lookupSymbol: vi.fn(() => []) },
    );

    const notFoundEvents = eventStore.replay({
      runId: notFoundCtx.runId,
      kind: 'agent.tool-call',
    });
    expect(notFoundEvents[0].payload).toMatchObject({
      tool_name: 'repo_intel.query',
      repo_intel_intent: 'find-symbol',
      status: 'ok',
      noMatches: true,
    });

    const invalidCtx = makeCtx({ runId: 'repo-intel-audit-invalid-still-failed' });
    await repoIntelQueryTool(invalidCtx, { intent: 'find-symbol' } as unknown as RepoIntelQuery);

    const invalidEvents = eventStore.replay({
      runId: invalidCtx.runId,
      kind: 'agent.tool-call',
    });
    expect(invalidEvents[0].payload).toMatchObject({
      tool_name: 'repo_intel.query',
      repo_intel_intent: 'find-symbol',
      status: 'failed',
      noMatches: false,
    });
  });

  it('audit event carries inputKeys including all provided fields', async () => {
    const ctx = makeCtx({ runId: 'repo-intel-audit-keys' });
    await repoIntelQueryTool(
      ctx,
      { intent: 'find-symbol', name: 'AuthService', kind: 'function' },
      { lookupSymbol: vi.fn(() => []) },
    );
    const events = eventStore.replay({ runId: ctx.runId, kind: 'agent.tool-call' });
    const payload = events[0].payload as Record<string, unknown>;
    expect(payload.tool_name).toBe('repo_intel.query');
    expect(payload.inputKeys).toEqual(['intent', 'kind', 'name']);
  });

  it.each([
    [
      'route-for-url',
      {
        intent: 'route-for-url',
        url: 'http://localhost:5173/projects/goose-hub-self',
        limit: 5,
        workItemId: 'github:demo/repo#1084',
      },
      {
        lookupRouteForUrl: vi.fn(() => [
          {
            pathPattern: '/projects/:slug',
            filePath: 'apps/web/src/App.tsx',
            line: 12,
            component: 'ProjectPage',
          },
        ]),
      },
    ],
    [
      'find-route',
      {
        intent: 'find-route',
        pathPattern: '/projects/:slug',
        limit: 5,
      },
      {
        lookupRoute: vi.fn(() => [
          {
            pathPattern: '/projects/:slug',
            filePath: 'apps/web/src/App.tsx',
            line: 12,
            component: 'ProjectPage',
          },
        ]),
      },
    ],
    [
      'find-symbol',
      {
        intent: 'find-symbol',
        name: 'AuthService',
        limit: 5,
      },
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
  ])(
    'canonicalizes benign extra keys for %s before refined validation',
    async (_name, query, deps) => {
      const result = await repoIntelQueryTool(
        makeCtx(),
        query as unknown as RepoIntelQuery,
        deps as RepoIntelDeps,
      );

      expect(result).toMatchObject({ ok: true, intent: query.intent });
    },
  );

  it('grounds proxied server API routes to the mounted Hono router file', async () => {
    mkdirSync(join(workspace, 'apps/server/src/domains/inbox'), { recursive: true });
    writeFileSync(
      join(workspace, 'apps/server/src/server.ts'),
      [
        "import { Hono } from 'hono';",
        "import { inboxRouter } from './domains/inbox/router.js';",
        'const app = new Hono();',
        "app.route('/inbox', inboxRouter);",
      ].join('\n'),
    );
    writeFileSync(
      join(workspace, 'apps/server/src/domains/inbox/router.ts'),
      [
        "import { Hono } from 'hono';",
        'const router = new Hono();',
        "router.post('/', async (c) => c.json({ ok: true }));",
        'export { router as inboxRouter };',
      ].join('\n'),
    );

    const result = await repoIntelQueryTool(makeCtx(), {
      intent: 'find-route',
      pathPattern: '/api/inbox',
    });

    expect(result).toMatchObject({ ok: true, intent: 'find-route', source: 'route-index' });
    if (result.ok) {
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pathPattern: '/inbox',
            filePath: 'apps/server/src/domains/inbox/router.ts',
            line: 3,
          }),
        ]),
      );
    }
  });

  it('audits original input keys when canonicalizing repo-intel input', async () => {
    const ctx = makeCtx({ runId: 'repo-intel-canonical-audit-keys' });
    await repoIntelQueryTool(
      ctx,
      {
        intent: 'route-for-url',
        url: 'http://localhost:5173/projects/goose-hub-self',
        limit: 5,
        workItemId: 'github:demo/repo#1084',
      } as unknown as RepoIntelQuery,
      {
        lookupRouteForUrl: vi.fn(() => [
          {
            pathPattern: '/projects/:slug',
            filePath: 'apps/web/src/App.tsx',
            line: 12,
            component: 'ProjectPage',
          },
        ]),
      },
    );

    const events = eventStore.replay({ runId: ctx.runId, kind: 'agent.tool-call' });
    expect(events[0].payload).toMatchObject({
      tool_name: 'repo_intel.query',
      status: 'ok',
      inputKeys: ['intent', 'limit', 'url', 'workItemId'],
    });
  });

  describe('grounding intents', () => {
    it('route-for-url normalizes scheme/host and returns matching routes', async () => {
      const lookupRouteForUrl = vi.fn(() => [
        {
          pathPattern: '/projects/:slug',
          filePath: 'apps/web/src/App.tsx',
          line: 12,
          component: 'ProjectPage',
        },
      ]);
      const result = await repoIntelQueryTool(
        makeCtx(),
        { intent: 'route-for-url', url: 'http://localhost:5173/projects/goose-hub-self' },
        { lookupRouteForUrl },
      );
      expect(result).toMatchObject({ ok: true, intent: 'route-for-url' });
      expect(lookupRouteForUrl).toHaveBeenCalledWith(
        'http://localhost:5173/projects/goose-hub-self',
        expect.any(Object),
      );
    });

    it('route-for-url returns not-found when no routes match', async () => {
      const result = await repoIntelQueryTool(
        makeCtx(),
        { intent: 'route-for-url', url: '/no-such-route' },
        { lookupRouteForUrl: vi.fn(() => []) },
      );
      expect(result).toMatchObject({ ok: false, reason: 'not-found' });
    });

    it('route-for-url is invalid without url field', async () => {
      const result = await repoIntelQueryTool(makeCtx(), {
        intent: 'route-for-url',
      } as unknown as RepoIntelQuery);
      expect(result).toMatchObject({ ok: false, reason: 'invalid-args' });
      if (!result.ok && result.reason === 'invalid-args')
        expect(result.fallbackHint).toContain('url');
    });

    it('fuzzy-component returns matches scored against the input phrase', async () => {
      const fuzzyFindComponents = vi.fn(() => [
        {
          component: 'ChatPanel',
          filePath: 'apps/web/src/components/chat/components/ChatPanel.tsx',
          line: 8,
          score: 2,
        },
        {
          component: 'ChatDock',
          filePath: 'apps/web/src/components/chat/components/ChatDock.tsx',
          line: 4,
          score: 1,
        },
      ]);
      const result = await repoIntelQueryTool(
        makeCtx(),
        { intent: 'fuzzy-component', phrase: 'chat panel widget' },
        { fuzzyFindComponents },
      );
      expect(result).toMatchObject({ ok: true, intent: 'fuzzy-component' });
      expect(fuzzyFindComponents).toHaveBeenCalledWith('chat panel widget', expect.any(Object));
      if (result.ok) expect(result.results).toHaveLength(2);
    });

    it('fuzzy-component is invalid without phrase', async () => {
      const result = await repoIntelQueryTool(makeCtx(), {
        intent: 'fuzzy-component',
      } as unknown as RepoIntelQuery);
      expect(result).toMatchObject({ ok: false, reason: 'invalid-args' });
      if (!result.ok && result.reason === 'invalid-args')
        expect(result.fallbackHint).toContain('phrase');
    });

    it('recent-touched returns files changed in the worktree without a candidate set', async () => {
      const gitRecentlyTouched = vi.fn(async () => [
        {
          path: { path: 'apps/web/src/App.tsx', root: 'worktree' as const },
          lastTouched: '2026-05-23T00:00:00Z',
          lastCommitSha: 'abc',
        },
      ]);
      const result = await repoIntelQueryTool(
        makeCtx(),
        { intent: 'recent-touched', sinceDays: 7 },
        { gitRecentlyTouched },
      );
      expect(result).toMatchObject({ ok: true, intent: 'recent-touched' });
      expect(gitRecentlyTouched).toHaveBeenCalledWith(expect.objectContaining({ sinceDays: 7 }));
    });

    it('recent-touched returns not-found when git reports no changes', async () => {
      const result = await repoIntelQueryTool(
        makeCtx(),
        { intent: 'recent-touched' },
        { gitRecentlyTouched: vi.fn(async () => []) },
      );
      expect(result).toMatchObject({ ok: false, reason: 'not-found' });
    });
  });
});
