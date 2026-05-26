import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetItem = vi.fn();
vi.mock('./source.js', () => ({
  isValidSlug: (slug: string) => /^[a-z0-9-]+$/.test(slug),
  getSourceForSlug: vi.fn(async (slug: string) => ({
    projectId: slug,
    repoRef: 'shaunnez/goose-hub',
    getItem: mockGetItem,
  })),
}));

const mockReplay = vi.fn();
vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    replay: (...args: unknown[]) => mockReplay(...args),
  },
}));

const mockListCostsForWorkItem = vi.fn();
vi.mock('@goose-hub/core/cost/repository.js', () => ({
  listCostsForWorkItem: (workItemId: string) => mockListCostsForWorkItem(workItemId),
}));

const mockListArtifactsForWorkItem = vi.fn();
vi.mock('@goose-hub/core/agent-artifacts/repository.js', () => ({
  listArtifactsForWorkItem: (projectId: string, workItemId: string) =>
    mockListArtifactsForWorkItem(projectId, workItemId),
}));

const mockGetIssueWorktreeDiff = vi.fn();
vi.mock('../domains/issues/diff.js', () => ({
  getIssueWorktreeDiff: (slug: string, id: string) => mockGetIssueWorktreeDiff(slug, id),
}));

import { canonicalizeWorkItemId, getWorkItemSnapshot } from './work-item-snapshot.js';

const item = {
  id: 'github:shaunnez/goose-hub#827',
  externalId: '827',
  repoRef: 'shaunnez/goose-hub',
  title: 'Issue-aware Hub Chat',
  body: 'Body',
  state: 'factory:needs-review',
  milestoneTitle: 'M20',
  priority: 'high',
  type: 'feature',
};

function event(id: number, kind: string, payload: unknown, runId = `run-${id}`) {
  return {
    id,
    projectId: 'goose-hub-self',
    workItemId: 'github:shaunnez/goose-hub#827',
    kind,
    payload,
    runId,
    personaId: null,
    createdAt: `2026-05-19T00:0${id}:00Z`,
  };
}

describe('work item snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetItem.mockResolvedValue(item);
    mockListCostsForWorkItem.mockReturnValue([]);
    mockListArtifactsForWorkItem.mockReturnValue([]);
    mockGetIssueWorktreeDiff.mockResolvedValue({ ok: true, data: { diff: null, runId: null } });
    mockReplay.mockImplementation((filter: { kind?: string; order?: string; limit?: number }) => {
      const all = [
        event(5, 'qa.completed', {
          verdict: 'pass',
          overallScore: 96,
          threshold: 70,
          testRun: { total: 3777, passed: 3770, failed: 0, skipped: 7, success: true },
          findings: [],
        }),
        event(4, 'qa.completed', {
          verdict: 'fail',
          overallScore: 40,
          testRun: { total: 10, passed: 8, failed: 2, skipped: 0, success: false },
        }),
        event(3, 'review.completed', { verdict: 'approved', confidence: 0.91 }),
        event(2, 'pr.opened', {
          prNumber: 99,
          prUrl: 'https://github.com/shaunnez/goose-hub/pull/99',
          branch: 'factory/run',
        }),
        event(1, 'qa.verification-summary-built', { changedFileCount: 3, diffCharCount: 1200 }),
      ];
      const scoped = filter.kind ? all.filter((candidate) => candidate.kind === filter.kind) : all;
      return filter.order === 'desc' ? scoped.slice(0, filter.limit ?? scoped.length) : scoped;
    });
  });

  it('canonicalizes raw route issue numbers to repo-qualified work item ids', async () => {
    await expect(canonicalizeWorkItemId('goose-hub-self', '827')).resolves.toBe(
      'github:shaunnez/goose-hub#827',
    );
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('uses the latest qa.completed testRun counts, matching the QA page source', async () => {
    const snapshot = await getWorkItemSnapshot('goose-hub-self', '827', {
      sections: ['issue', 'qa', 'code', 'review', 'costs', 'timeline'],
    });
    expect(snapshot.issue).toMatchObject({ number: '827', state: 'factory:needs-review' });
    expect(snapshot.qa).toMatchObject({
      verdict: 'pass',
      score: 96,
      testRun: { passed: 3770, failed: 0, skipped: 7, total: 3777 },
      source: { eventId: 5, kind: 'qa.completed', runId: 'run-5' },
    });
    expect(snapshot.code).toMatchObject({
      prNumber: 99,
      branch: 'factory/run',
      changedFileCount: 3,
    });
    expect(snapshot.review).toMatchObject({ verdict: 'approved', confidence: 0.91 });
  });

  it('expands full code context with file names and diff stat', async () => {
    mockGetIssueWorktreeDiff.mockResolvedValueOnce({
      ok: true,
      data: {
        runId: 'run-diff',
        diff:
          'diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n' +
          'diff --git a/src/b.ts b/src/b.ts\n@@ -1,0 +1 @@\n+added\n',
      },
    });
    const snapshot = await getWorkItemSnapshot('goose-hub-self', '827', {
      sections: ['code'],
      depth: 'full',
    });
    expect(snapshot.code).toMatchObject({
      changedFileCount: 2,
      files: ['src/a.ts', 'src/b.ts'],
      additions: 2,
      deletions: 1,
      diffRunId: 'run-diff',
    });
  });
});
