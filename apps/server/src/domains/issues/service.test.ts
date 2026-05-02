import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { isLegalTransition } from '@goose-hub/core/state-machine/transitions.js';
import { bustCache } from '../../shared/cache.js';
import { getSourceForSlug } from '../../shared/source.js';
import {
  commentOnIssue,
  fakeRun,
  getIssue,
  listIssues,
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
    expect(result).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/invalid.*from/i) });
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
});

describe('listIssues', () => {
  it('returns 404 for unknown project', async () => {
    vi.mocked(getSourceForSlug).mockResolvedValueOnce(null);
    const result = await listIssues('unknown');
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('returns items from source', async () => {
    mockSource.listOpenWork.mockResolvedValueOnce([{ id: 'github:owner/repo#1' }]);
    const result = await listIssues('proj');
    expect(result).toMatchObject({ ok: true, data: { items: [{ id: 'github:owner/repo#1' }] } });
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
});
