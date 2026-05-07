/**
 * Fetch-guard test (#566 Phase 4).
 *
 * Verifies that when MOCK_SOURCE=true, no real GitHub API calls escape to
 * api.github.com or github.com. Monkey-patches globalThis.fetch to throw on
 * those domains.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('MOCK_SOURCE fetch guard', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.MOCK_SOURCE;

  beforeEach(() => {
    process.env.MOCK_SOURCE = 'true';
    process.env.MOCK_AGENTS = 'true';
    process.env.MOCK_OPEN_PR = 'true';

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/api\.github\.com|github\.com/.test(url)) {
        throw new Error(`[fetch-guard] Real GitHub fetch blocked in MOCK_SOURCE mode: ${url}`);
      }
      return originalFetch(input, _init);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnv == null) {
      process.env.MOCK_SOURCE = undefined;
    } else {
      process.env.MOCK_SOURCE = originalEnv;
    }
    process.env.MOCK_AGENTS = undefined;
    process.env.MOCK_OPEN_PR = undefined;

    // Reset source cache so each test gets a fresh InMemoryLabelsSource
    vi.resetModules();
  });

  it('InMemoryLabelsSource does not call fetch', async () => {
    const { InMemoryLabelsSource } = await import(
      '@goose-hub/core/state-source/in-memory-labels.js'
    );
    const source = new InMemoryLabelsSource('test-project', 'shaunnez/goose-hub');

    // These operations must not hit real GitHub
    const item = await source.createIssue({ title: 'Test issue', body: 'body' });
    await source.comment(item.externalId, 'a comment');
    const comments = await source.listComments(item.externalId);
    const open = await source.listOpenWork();
    const fetched = await source.getItem(item.externalId);
    await source.forceState(item.externalId, 'factory:accepted');
    await source.transitionState(item.externalId, 'factory:accepted', 'factory:dev-ready');
    const milestone = await source.getActiveMilestone();

    expect(comments).toHaveLength(1);
    expect(open).toHaveLength(1);
    expect(fetched.externalId).toBe(item.externalId);
    expect(milestone).not.toBeNull();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('MOCK_SOURCE merge-pr early-return skips fetch', async () => {
    const { mergePR } = await import('@goose-hub/core/connectors/github/merge-pr.js');
    const result = await mergePR({ repo: 'shaunnez/goose-hub', prNumber: 999, token: '' });
    expect(result).toEqual({ sha: 'mock-sha', merged: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('MOCK_SOURCE open-pr early-return skips fetch and git', async () => {
    const { openPR } = await import('@goose-hub/core/connectors/github/open-pr.js');
    const result = await openPR({
      worktreePath: '/mock/worktree',
      repo: 'shaunnez/goose-hub',
      issueNumber: 1,
      title: 'M7.01: mock',
      body: 'Closes #1',
      branchName: 'factory/mock',
      token: '',
    });
    expect(result.prNumber).toBe(999);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('MOCK_SOURCE dependency-resolver skips fetch', async () => {
    const { createProjectAwareTargetSource } = await import(
      '@goose-hub/core/state-source/dependency-resolver.js'
    );
    const fetchTarget = await createProjectAwareTargetSource({
      projects: [
        {
          id: 'test',
          slug: 'test',
          source: { kind: 'github', repo: 'shaunnez/goose-hub' },
          budgets: { maxParallelAgents: 1, maxIssuesPerDayFromNonOwners: 5, maxRetries: 2 },
        } as never,
      ],
    });
    const target = await fetchTarget('shaunnez/goose-hub', 42);
    expect(target).not.toBeNull();
    expect((target as { state: string }).state).toBe('open');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
