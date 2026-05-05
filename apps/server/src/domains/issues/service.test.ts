import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    // Default: pass through to real readFileSync; individual tests can override
    readFileSync: vi.fn().mockImplementation(actual.readFileSync),
    existsSync: vi.fn().mockImplementation(actual.existsSync),
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn().mockImplementation(actual.execFileSync),
  };
});

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: { appendEvent: vi.fn(), replay: vi.fn().mockReturnValue([]) },
}));
vi.mock('@goose-hub/core/state-machine/states.js', () => ({
  STATES: ['factory:triaging', 'factory:accepted', 'factory:in-progress', 'factory:done'],
}));
vi.mock('@goose-hub/core/state-machine/transitions.js', () => ({
  isLegalTransition: vi.fn().mockReturnValue(true),
  legalTargets: vi.fn().mockReturnValue([]),
}));
vi.mock('../../shared/source.js', () => ({
  getSourceForSlug: vi.fn(),
  // Use the real implementation — defence-in-depth check is just a regex (#201).
  isValidSlug: (slug: string) => /^[a-z0-9-]+$/.test(slug),
}));
vi.mock('../../shared/projects.js', () => ({
  getProject: vi.fn().mockResolvedValue({ source: { kind: 'github', repo: 'owner/repo' } }),
}));
vi.mock('../../shared/cache.js', () => ({
  getCached: vi.fn().mockImplementation((_k, _t, f) => f()),
  bustCache: vi.fn(),
  CACHE_KEY: {
    issues: (s: string) => `issues:${s}`,
    milestones: (s: string) => `milestones:${s}`,
    closedIssues: (s: string, m: number) => `closed-issues:${s}:${m}`,
    milestoneIssues: (s: string, m: number) => `milestone-issues:${s}:${m}`,
  },
}));
vi.mock('../../shared/resolve-milestone.js', () => ({
  resolveActiveMilestone: vi
    .fn()
    .mockResolvedValue({ milestoneNumber: null, source: 'github-default' }),
}));

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { isLegalTransition } from '@goose-hub/core/state-machine/transitions.js';
import { bustCache } from '#shared/cache.js';
import { resolveActiveMilestone } from '#shared/resolve-milestone.js';
import { getSourceForSlug } from '#shared/source.js';
import {
  commentOnIssue,
  fakeRun,
  getIssue,
  listIssues,
  overrideIssueRepo,
  setIssueLabel,
  transitionIssue,
} from './service.js';

const mockSource = {
  repoRef: 'owner/repo',
  projectId: 'test-proj',
  transitionState: vi.fn().mockResolvedValue(undefined),
  comment: vi.fn().mockResolvedValue(undefined),
  setMilestone: vi.fn().mockResolvedValue(undefined),
  setLabelInGroup: vi.fn().mockResolvedValue(undefined),
  listOpenWork: vi.fn().mockResolvedValue([]),
  getItem: vi.fn().mockResolvedValue({ id: 'github:owner/repo#1' }),
  listComments: vi.fn().mockResolvedValue([]),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSourceForSlug).mockResolvedValue(mockSource as never);
});

describe('transitionIssue — validation', () => {
  it('returns 400 when from is missing', async () => {
    const result = await transitionIssue('proj', '1', null, 'factory:triaging');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 400 when from is not a valid state', async () => {
    const result = await transitionIssue('proj', '1', 'not-a-state', 'factory:triaging');
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: expect.stringMatching(/invalid.*from/i),
    });
  });

  it('returns 400 when to is not a valid state', async () => {
    const result = await transitionIssue('proj', '1', 'factory:triaging', 'not-a-state');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 422 when transition is illegal', async () => {
    vi.mocked(isLegalTransition).mockReturnValueOnce(false);
    const result = await transitionIssue('proj', '1', 'factory:triaging', 'factory:done');
    expect(result).toMatchObject({ ok: false, status: 422 });
  });

  it('returns 404 when project not found', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await transitionIssue('unknown', '1', 'factory:triaging', 'factory:accepted');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('emits state.transitioned event on success', async () => {
    const result = await transitionIssue('proj', '1', 'factory:triaging', 'factory:accepted');
    expect(result.ok).toBe(true);
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'state.transitioned' }),
    );
  });
});

describe('commentOnIssue — validation', () => {
  it('returns 400 when body is empty', async () => {
    const result = await commentOnIssue('proj', '1', '');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 400 when body is whitespace-only', async () => {
    const result = await commentOnIssue('proj', '1', '   ');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 404 when project not found', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await commentOnIssue('unknown', '1', 'hello');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('posts comment and emits event on success', async () => {
    const result = await commentOnIssue('proj', '1', 'Great idea');
    expect(result.ok).toBe(true);
    expect(mockSource.comment).toHaveBeenCalledWith('github:owner/repo#1', 'Great idea');
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'manual.action' }),
    );
  });
});

describe('setIssueLabel — validation', () => {
  it('returns 400 for unknown group', async () => {
    const result = await setIssueLabel('proj', '1', 'type', 'bug');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 400 for invalid priority value', async () => {
    const result = await setIssueLabel('proj', '1', 'priority', 'urgent');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 400 for invalid schedule value', async () => {
    const result = await setIssueLabel('proj', '1', 'schedule', 'next');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('returns 404 when project not found', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await setIssueLabel('unknown', '1', 'priority', 'high');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns ok for valid priority:high', async () => {
    const result = await setIssueLabel('proj', '1', 'priority', 'high');
    expect(result.ok).toBe(true);
  });

  it('returns ok for valid schedule:current', async () => {
    const result = await setIssueLabel('proj', '1', 'schedule', 'current');
    expect(result.ok).toBe(true);
  });

  it('accepts schedule:blocked-by and writes the correct label (#202)', async () => {
    const result = await setIssueLabel('proj', '1', 'schedule', 'blocked-by');
    expect(result.ok).toBe(true);
    expect(mockSource.setLabelInGroup).toHaveBeenCalledWith(
      'github:owner/repo#1',
      'schedule',
      'blocked-by',
    );
  });
});

describe('listIssues', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await listIssues('unknown');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('calls listOpenWork with no milestone when resolveActiveMilestone returns null', async () => {
    vi.mocked(resolveActiveMilestone).mockResolvedValueOnce({
      milestoneNumber: null,
      source: 'github-default',
    });
    mockSource.listOpenWork.mockResolvedValueOnce([{ id: 'github:owner/repo#1' }]);
    const result = await listIssues('proj');
    expect(mockSource.listOpenWork).toHaveBeenCalledWith(undefined);
    expect(result).toMatchObject({ ok: true, data: { items: [{ id: 'github:owner/repo#1' }] } });
  });

  it('calls listOpenWork with milestone number when resolveActiveMilestone returns one', async () => {
    vi.mocked(resolveActiveMilestone).mockResolvedValueOnce({
      milestoneNumber: 10,
      source: 'config',
    });
    mockSource.listOpenWork.mockResolvedValueOnce([{ id: 'github:owner/repo#42' }]);
    const result = await listIssues('proj');
    expect(mockSource.listOpenWork).toHaveBeenCalledWith(10);
    expect(result).toMatchObject({ ok: true, data: { items: [{ id: 'github:owner/repo#42' }] } });
  });

  it('two projects with different active milestones produce independent filtered sets', async () => {
    const sourceA = {
      ...mockSource,
      listOpenWork: vi.fn().mockResolvedValue([{ id: 'github:owner/repo#1', externalId: '1' }]),
    };
    const sourceB = {
      ...mockSource,
      listOpenWork: vi.fn().mockResolvedValue([{ id: 'github:owner/repo#99', externalId: '99' }]),
    };
    vi.mocked(getSourceForSlug)
      .mockResolvedValueOnce(sourceA as never)
      .mockResolvedValueOnce(sourceB as never);
    vi.mocked(resolveActiveMilestone)
      .mockResolvedValueOnce({ milestoneNumber: 10, source: 'config' })
      .mockResolvedValueOnce({ milestoneNumber: 5, source: 'config' });

    const [r1, r2] = await Promise.all([listIssues('proj-a'), listIssues('proj-b')]);

    expect(sourceA.listOpenWork).toHaveBeenCalledWith(10);
    expect(sourceB.listOpenWork).toHaveBeenCalledWith(5);
    expect(r1).toMatchObject({ ok: true });
    expect(r2).toMatchObject({ ok: true });
    const items1 = (r1 as { ok: true; data: { items: { id: string }[] } }).data.items;
    const items2 = (r2 as { ok: true; data: { items: { id: string }[] } }).data.items;
    expect(items1.map((i) => i.id)).not.toEqual(items2.map((i) => i.id));
  });
});

describe('getIssue', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await getIssue('unknown', '1');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});

describe('fakeRun', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await fakeRun('unknown', '1', 'triage');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('defaults to triage skill for unknown skill name', async () => {
    const result = await fakeRun('proj', '1', 'unknown-skill');
    expect(result).toMatchObject({ ok: true, data: { skill: 'triage' } });
  });

  it('uses investigate when requested', async () => {
    const result = await fakeRun('proj', '1', 'investigate');
    expect(result).toMatchObject({ ok: true, data: { skill: 'investigate' } });
  });

  it('returns 404 in production, refusing to emit synthetic events (#203)', async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const result = await fakeRun('proj', '1', 'triage');
      expect(result).toMatchObject({
        ok: false,
        error: 'fake-run is disabled in production',
        status: 404,
      });
      // Confirm getSourceForSlug is never called — the production guard
      // short-circuits before any side effect.
      expect(getSourceForSlug).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});

describe('getIssueWorktreeDiff (#185)', () => {
  beforeEach(() => {
    vi.mocked(eventStore.appendEvent).mockClear();
  });

  it('returns 400 for invalid slug (defence-in-depth)', async () => {
    const { getIssueWorktreeDiff } = await import('./service.js');
    const result = await getIssueWorktreeDiff('../etc/hosts', '1');
    // The source-not-found guard fires first since `getSourceForSlug` returns
    // null for unknown slugs in this mocked setup. Either 404 or 400 satisfies
    // the defence-in-depth contract.
    expect(result.ok).toBe(false);
  });

  it('returns { diff: null } when no in-flight run exists for the issue', async () => {
    const { getIssueWorktreeDiff } = await import('./service.js');
    const events = await import('@goose-hub/core/event-stream/store.js');
    vi.mocked(events.eventStore.replay).mockReturnValueOnce([]);
    const result = await getIssueWorktreeDiff('proj', '1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.diff).toBeNull();
      expect(result.data.runId).toBeNull();
      expect(result.data.reason).toContain('no in-flight run');
    }
  });

  it('returns { diff: null } with the runId when worktree was cleaned up', async () => {
    const { getIssueWorktreeDiff } = await import('./service.js');
    const events = await import('@goose-hub/core/event-stream/store.js');
    vi.mocked(events.eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'pr.opened',
        runId: 'run-cleaned-up-12345',
        payload: {},
        createdAt: '2026-05-02T22:00:00Z',
      },
    ] as never);
    const result = await getIssueWorktreeDiff('proj', '1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.diff).toBeNull();
      expect(result.data.runId).toBe('run-cleaned-up-12345');
      expect(result.data.reason).toContain('worktree not found');
    }
  });

  it('git diff args exclude .claude/ directory', async () => {
    const { getIssueWorktreeDiff } = await import('./service.js');
    const events = await import('@goose-hub/core/event-stream/store.js');
    vi.mocked(events.eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'agent.run-started',
        runId: 'run-live-aabbcc',
        payload: {},
        createdAt: '2026-05-02T22:00:00Z',
      },
    ] as never);
    vi.mocked(existsSync).mockImplementation((p) => String(p).includes('run-live-aabbcc'));
    vi.mocked(execFileSync).mockReturnValueOnce(
      'diff --git a/src/foo.ts b/src/foo.ts\n+added line' as never,
    );
    const result = await getIssueWorktreeDiff('proj', '1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.diff).toContain('+added line');
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining([':(exclude).claude/']),
      expect.any(Object),
    );
  });

  it('fetches diff from GitHub PR when worktree is gone and pr.opened event has prNumber', async () => {
    const { getIssueWorktreeDiff } = await import('./service.js');
    const events = await import('@goose-hub/core/event-stream/store.js');
    process.env.GITHUB_TOKEN = 'ghp_test';
    vi.mocked(events.eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'pr.opened',
        runId: 'run-pr-gone-99887',
        payload: { prNumber: 42, prUrl: 'https://github.com/owner/repo/pull/42' },
        createdAt: '2026-05-02T22:00:00Z',
      },
    ] as never);
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('diff --git a/src/bar.ts b/src/bar.ts\n+github line'),
    });
    const result = await getIssueWorktreeDiff('proj', '1', {
      fetchImpl: mockFetch as typeof fetch,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.diff).toBe('diff --git a/src/bar.ts b/src/bar.ts\n+github line');
      expect(result.data.runId).toBe('run-pr-gone-99887');
    }
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/pulls/42',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/vnd.github.v3.diff' }),
      }),
    );
  });
});

describe('approveIssue / rejectIssue (#186)', () => {
  beforeEach(() => {
    vi.mocked(eventStore.appendEvent).mockClear();
    process.env.GITHUB_TOKEN = 'ghp_test';
  });

  it('rejectIssue rejects empty / whitespace reason with 400', async () => {
    const { rejectIssue } = await import('./service.js');
    expect(await rejectIssue('proj', '1', '')).toMatchObject({ ok: false, status: 400 });
    expect(await rejectIssue('proj', '1', '   ')).toMatchObject({ ok: false, status: 400 });
    expect(await rejectIssue('proj', '1', undefined)).toMatchObject({ ok: false, status: 400 });
  });

  it('rejectIssue posts a comment, emits gate.rejected, transitions to needs-fix', async () => {
    const { rejectIssue } = await import('./service.js');
    const result = await rejectIssue('proj', '1', 'tests are flaky');
    expect(result).toMatchObject({ ok: true });
    expect(mockSource.comment).toHaveBeenCalledWith(
      '1',
      expect.stringContaining('tests are flaky'),
    );
    expect(mockSource.transitionState).toHaveBeenCalledWith(
      '1',
      'factory:approved',
      'factory:needs-fix',
    );
    const rejected = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'gate.rejected');
    expect(rejected).toBeDefined();
  });

  it('approveIssue rejects when no pr.opened event exists', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([]);
    const { approveIssue } = await import('./service.js');
    const result = await approveIssue('proj', '1');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('approveIssue merges via the connector and transitions to factory:retrospecting', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'pr.opened',
        runId: 'run-1',
        payload: { prNumber: 99, prUrl: 'u', branch: 'b' },
        createdAt: '2026-05-02T22:00:00Z',
      },
    ] as never);

    const mergePRImpl = vi.fn().mockResolvedValueOnce({ sha: 'abc1234', merged: true });

    const { approveIssue } = await import('./service.js');
    const result = await approveIssue('proj', '1', { mergePRImpl });
    expect(result).toMatchObject({ ok: true, data: { sha: 'abc1234', prNumber: 99 } });
    expect(mergePRImpl).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'owner/repo', prNumber: 99 }),
    );
    expect(mockSource.transitionState).toHaveBeenCalledWith(
      '1',
      'factory:approved',
      'factory:retrospecting',
    );
    const approved = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'gate.approved');
    expect(approved).toBeDefined();
    const merged = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'pr.merged');
    expect(merged).toBeDefined();
  });

  it('approveIssue returns 409 and transitions to merge-conflict when GitHub 405', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'pr.opened',
        runId: 'run-1',
        payload: { prNumber: 42, prUrl: 'https://github.com/owner/repo/pull/42', branch: 'b' },
        createdAt: '2026-05-05T10:00:00Z',
      },
    ] as never);

    const { MergeConflictError } = await import('@goose-hub/core/connectors/github/merge-pr.js');
    const mergePRImpl = vi.fn().mockRejectedValueOnce(new MergeConflictError(42));

    const { approveIssue } = await import('./service.js');
    const result = await approveIssue('proj', '1', { mergePRImpl });

    expect(result).toMatchObject({ ok: false, status: 409, error: 'merge-conflict' });
    expect(mockSource.transitionState).toHaveBeenCalledWith(
      '1',
      'factory:approved',
      'factory:merge-conflict',
    );
    const conflictEvent = vi
      .mocked(eventStore.appendEvent)
      .mock.calls.find(([e]) => e.kind === 'merge.conflict');
    expect(conflictEvent).toBeDefined();
  });
});

describe('getIssueEvents', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const { getIssueEvents } = await import('./service.js');
    const result = await getIssueEvents('unknown', '1');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns events in reverse order (newest first)', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        kind: 'agent.spawned',
        payload: {},
        projectId: 'proj',
        workItemId: 'x',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 2,
        kind: 'agent.terminated',
        payload: {},
        projectId: 'proj',
        workItemId: 'x',
        createdAt: '2026-01-01T00:00:01Z',
      },
    ] as never);
    const { getIssueEvents } = await import('./service.js');
    const result = await getIssueEvents('proj', '1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const events = result.data.events as Array<{ id: number }>;
      expect(events[0].id).toBe(2);
      expect(events[1].id).toBe(1);
    }
  });
});

describe('getIssueComments', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const { getIssueComments } = await import('./service.js');
    const result = await getIssueComments('unknown', '1');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns comments from source', async () => {
    const comments = [{ id: 1, body: 'hello' }];
    mockSource.listComments.mockResolvedValueOnce(comments);
    const { getIssueComments } = await import('./service.js');
    const result = await getIssueComments('proj', '1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.comments).toEqual(comments);
    }
  });
});

describe('getIssueTriage', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const { getIssueTriage } = await import('./service.js');
    const result = await getIssueTriage('unknown', '1');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns triage: null when no triage event exists', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([]);
    const { getIssueTriage } = await import('./service.js');
    const result = await getIssueTriage('proj', '1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.triage).toBeNull();
    }
  });

  it('returns triage dto when agent.triage-complete event exists', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'agent.triage-complete',
        runId: null,
        payload: {
          triage: { type: 'bug', priority: 'high' },
          repoMatch: {
            candidates: [{ repo: 'owner/repo', confidence: 90, evidence: 'match', tier: 1 }],
          },
        },
        createdAt: '2026-01-01T00:00:00Z',
      },
    ] as never);
    const { getIssueTriage } = await import('./service.js');
    const result = await getIssueTriage('proj', '1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const triage = result.data.triage as Record<string, unknown>;
      expect(triage.type).toBe('bug');
      expect(triage.priority).toBe('high');
      expect(triage.overrideRepo).toBeNull();
    }
  });

  it('returns triage with overrideRepo when agent.repo-override event exists', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'agent.triage-complete',
        runId: null,
        payload: {
          triage: { type: 'feature', priority: 'medium' },
          repoMatch: { candidates: [] },
        },
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 2,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'agent.repo-override',
        runId: null,
        payload: { repo: 'owner/other-repo' },
        createdAt: '2026-01-01T00:00:01Z',
      },
    ] as never);
    const { getIssueTriage } = await import('./service.js');
    const result = await getIssueTriage('proj', '1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const triage = result.data.triage as Record<string, unknown>;
      expect(triage.overrideRepo).toBe('owner/other-repo');
    }
  });
});

describe('setIssueMilestone', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const { setIssueMilestone } = await import('./service.js');
    const result = await setIssueMilestone('unknown', '1', 5);
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('calls setMilestone and emits manual.action event on success', async () => {
    const { setIssueMilestone } = await import('./service.js');
    const result = await setIssueMilestone('proj', '1', 3);
    expect(result.ok).toBe(true);
    expect(mockSource.setMilestone).toHaveBeenCalledWith('github:owner/repo#1', 3);
    expect(eventStore.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'manual.action' }),
    );
  });

  it('can set milestone to null to clear it', async () => {
    const { setIssueMilestone } = await import('./service.js');
    const result = await setIssueMilestone('proj', '1', null);
    expect(result.ok).toBe(true);
    expect(mockSource.setMilestone).toHaveBeenCalledWith('github:owner/repo#1', null);
  });
});

describe('approveIssue — edge cases', () => {
  it('returns 404 when project not found', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const { approveIssue } = await import('./service.js');
    const result = await approveIssue('unknown', '1');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns 500 when pr.opened event has no prNumber', async () => {
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        projectId: 'proj',
        workItemId: 'github:owner/repo#1',
        kind: 'pr.opened',
        runId: 'run-1',
        payload: {}, // no prNumber
        createdAt: '2026-05-02T22:00:00Z',
      },
    ] as never);
    const { approveIssue } = await import('./service.js');
    const result = await approveIssue('proj', '1');
    expect(result).toMatchObject({
      ok: false,
      status: 500,
      error: expect.stringContaining('prNumber'),
    });
  });

  it('returns 500 when GITHUB_TOKEN is not set', async () => {
    const savedToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = '';
    try {
      vi.mocked(eventStore.replay).mockReturnValueOnce([
        {
          id: 1,
          projectId: 'proj',
          workItemId: 'github:owner/repo#1',
          kind: 'pr.opened',
          runId: 'run-1',
          payload: { prNumber: 5 },
          createdAt: '2026-05-02T22:00:00Z',
        },
      ] as never);
      const { approveIssue } = await import('./service.js');
      const result = await approveIssue('proj', '1');
      expect(result).toMatchObject({
        ok: false,
        status: 500,
        error: expect.stringContaining('GITHUB_TOKEN'),
      });
    } finally {
      if (savedToken !== undefined) process.env.GITHUB_TOKEN = savedToken;
    }
  });
});

describe('overrideIssueRepo — body (requires repos.md mock)', () => {
  it('returns 404 when source not found after valid slug', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await overrideIssueRepo('valid-slug', '1', 'owner/repo');
    // source is null so returns 404
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns 400 when repo is not in the allowlist', async () => {
    vi.mocked(readFileSync).mockReturnValueOnce('### [owner/allowed-repo]\n' as never);
    const result = await overrideIssueRepo('proj', '1', 'owner/not-allowed');
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: expect.stringContaining('not in allowlist'),
    });
  });

  it('returns triage null when repo is allowed but no triage event exists', async () => {
    vi.mocked(readFileSync).mockReturnValueOnce('### [owner/repo]\n' as never);
    vi.mocked(eventStore.replay).mockReturnValueOnce([]);
    const result = await overrideIssueRepo('proj', '1', 'owner/repo');
    expect(result).toMatchObject({ ok: true, data: { triage: null } });
  });

  it('returns triage dto when repo is allowed and triage event exists', async () => {
    vi.mocked(readFileSync).mockReturnValueOnce('### [owner/repo]\n' as never);
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        kind: 'agent.triage-complete',
        payload: {
          triage: { type: 'bug', priority: 'high' },
          repoMatch: { candidates: [] },
        },
        projectId: 'proj',
        workItemId: 'x',
        createdAt: '2026-01-01',
      },
    ] as never);
    const result = await overrideIssueRepo('proj', '1', 'owner/repo');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const triage = result.data.triage as Record<string, unknown>;
      expect(triage.type).toBe('bug');
      expect(triage.overrideRepo).toBe('owner/repo');
    }
  });
});

describe('fakeRun — async event emission (#203)', () => {
  it('emits agent.spawned synchronously relative to return value, not waiting for setTimeout', async () => {
    vi.useFakeTimers();
    try {
      const result = await fakeRun('proj', '1', 'triage');
      expect(result).toMatchObject({ ok: true, data: { skill: 'triage' } });
      // Advance timers to let the async IIFE complete
      await vi.runAllTimersAsync();
      // agent.spawned should have been emitted
      const spawnedCall = vi
        .mocked(eventStore.appendEvent)
        .mock.calls.find(([e]) => e.kind === 'agent.spawned');
      expect(spawnedCall).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('overrideIssueRepo (#201 slug guard)', () => {
  it('rejects path-traversal slug with 400', async () => {
    const result = await overrideIssueRepo('../etc/hosts', '1', 'owner/repo');
    expect(result).toEqual({ ok: false, error: 'invalid slug', status: 400 });
    // Importantly, getSourceForSlug is never called for an invalid slug.
    expect(getSourceForSlug).not.toHaveBeenCalled();
  });

  it('rejects slug with slashes with 400', async () => {
    const result = await overrideIssueRepo('foo/bar', '1', 'owner/repo');
    expect(result).toEqual({ ok: false, error: 'invalid slug', status: 400 });
  });

  it('rejects empty slug with 400', async () => {
    const result = await overrideIssueRepo('', '1', 'owner/repo');
    expect(result).toEqual({ ok: false, error: 'invalid slug', status: 400 });
  });

  it('still rejects when repo is not provided (repo guard fires first)', async () => {
    const result = await overrideIssueRepo('valid-slug', '1', undefined);
    expect(result).toMatchObject({ ok: false, error: 'repo is required', status: 400 });
  });
});
