import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ──────────────────────────────────────────────────────────────

const {
  mockListIssues,
  mockGetIssue,
  mockGetIssueLegalTargets,
  mockGetIssueEvents,
  mockGetIssueArtifact,
  mockGetIssueComments,
  mockGetIssuePrd,
  mockGetIssueAcceptanceContract,
  mockGetIssueTriage,
  mockGetIssueWorktreeDiff,
  mockTransitionIssue,
  mockCommentOnIssue,
  mockSetIssueMilestone,
  mockSetIssueLabel,
  mockOverrideIssueRepo,
  mockApproveIssue,
  mockRejectIssue,
  mockApprovePRD,
  mockRejectPRD,
  mockDeclinePRD,
  mockRevisePRD,
  mockProceedToPrd,
  mockDispatchResolveConflict,
  mockGetIssueSpec,
} = vi.hoisted(() => ({
  mockListIssues: vi.fn(),
  mockGetIssue: vi.fn(),
  mockGetIssueLegalTargets: vi.fn(),
  mockGetIssueEvents: vi.fn(),
  mockGetIssueArtifact: vi.fn(),
  mockGetIssueComments: vi.fn(),
  mockGetIssuePrd: vi.fn(),
  mockGetIssueAcceptanceContract: vi.fn(),
  mockGetIssueTriage: vi.fn(),
  mockGetIssueWorktreeDiff: vi.fn(),
  mockTransitionIssue: vi.fn(),
  mockCommentOnIssue: vi.fn(),
  mockSetIssueMilestone: vi.fn(),
  mockSetIssueLabel: vi.fn(),
  mockOverrideIssueRepo: vi.fn(),
  mockApproveIssue: vi.fn(),
  mockRejectIssue: vi.fn(),
  mockApprovePRD: vi.fn(),
  mockRejectPRD: vi.fn(),
  mockDeclinePRD: vi.fn(),
  mockRevisePRD: vi.fn(),
  mockProceedToPrd: vi.fn(),
  mockDispatchResolveConflict: vi.fn().mockResolvedValue(undefined),
  mockGetIssueSpec: vi.fn(),
}));

vi.mock('./service.js', () => ({
  listIssues: mockListIssues,
  getIssue: mockGetIssue,
  getIssueLegalTargets: mockGetIssueLegalTargets,
  getIssueEvents: mockGetIssueEvents,
  getIssueArtifact: mockGetIssueArtifact,
  getIssueComments: mockGetIssueComments,
  getIssuePrd: mockGetIssuePrd,
  getIssueAcceptanceContract: mockGetIssueAcceptanceContract,
  getIssueTriage: mockGetIssueTriage,
  getIssueWorktreeDiff: mockGetIssueWorktreeDiff,
  transitionIssue: mockTransitionIssue,
  commentOnIssue: mockCommentOnIssue,
  setIssueMilestone: mockSetIssueMilestone,
  setIssueLabel: mockSetIssueLabel,
  overrideIssueRepo: mockOverrideIssueRepo,
  approveIssue: mockApproveIssue,
  rejectIssue: mockRejectIssue,
  approvePRD: mockApprovePRD,
  rejectPRD: mockRejectPRD,
  declinePRD: mockDeclinePRD,
  revisePRD: mockRevisePRD,
  proceedToPrd: mockProceedToPrd,
  getIssueSpec: mockGetIssueSpec,
}));

vi.mock('@goose-hub/core/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('#shared/dispatch.js', () => ({
  dispatchResolveConflict: mockDispatchResolveConflict,
}));

import { issuesRouter } from './router.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  return new Hono().route('/projects', issuesRouter);
}

async function postJson(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('GET /projects/:slug/issues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with items on success', async () => {
    const items = [{ id: 'issue-1' }, { id: 'issue-2' }];
    mockListIssues.mockResolvedValue({ ok: true, data: { items } });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual(items);
    expect(mockListIssues).toHaveBeenCalledWith('my-project');
  });

  it('returns 404 when project not found', async () => {
    mockListIssues.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const app = makeApp();
    const res = await app.request('/projects/unknown/issues', { method: 'GET' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('project not found');
  });
});

describe('GET /projects/:slug/issues/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with item on success', async () => {
    const item = { id: 'issue-42', title: 'Fix bug' };
    mockGetIssue.mockResolvedValue({ ok: true, data: { item } });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: unknown };
    expect(body.item).toEqual(item);
    expect(mockGetIssue).toHaveBeenCalledWith('my-project', '42');
  });

  it('returns 404 when project not found', async () => {
    mockGetIssue.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const app = makeApp();
    const res = await app.request('/projects/unknown/issues/1', { method: 'GET' });
    expect(res.status).toBe(404);
  });
});

describe('GET /projects/:slug/issues/:id/events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with events on success', async () => {
    const events = [{ kind: 'agent.spawned' }, { kind: 'agent.terminated' }];
    mockGetIssueEvents.mockResolvedValue({ ok: true, data: { events } });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/events', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events).toEqual(events);
    expect(mockGetIssueEvents).toHaveBeenCalledWith('my-project', '42', undefined);
  });

  it('returns 404 when project not found', async () => {
    mockGetIssueEvents.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const app = makeApp();
    const res = await app.request('/projects/unknown/issues/1/events', { method: 'GET' });
    expect(res.status).toBe(404);
  });
});

describe('GET /projects/:slug/issues/:id/comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with comments on success', async () => {
    const comments = [{ body: 'First comment' }];
    mockGetIssueComments.mockResolvedValue({ ok: true, data: { comments } });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/comments', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { comments: unknown[] };
    expect(body.comments).toEqual(comments);
    expect(mockGetIssueComments).toHaveBeenCalledWith('my-project', '42');
  });

  it('returns 404 when project not found', async () => {
    mockGetIssueComments.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const app = makeApp();
    const res = await app.request('/projects/unknown/issues/1/comments', { method: 'GET' });
    expect(res.status).toBe(404);
  });
});

describe('GET /projects/:slug/issues/:id/prd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with the latest PRD read model on success', async () => {
    const prd = {
      prd: { title: 'Stored PRD' },
      advisorConcerns: null,
      source: 'event',
      createdAt: '2026-05-21T00:00:00.000Z',
      runId: 'run-1',
    };
    mockGetIssuePrd.mockResolvedValue({ ok: true, data: { prd } });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/prd', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { prd: unknown };
    expect(body.prd).toEqual(prd);
    expect(mockGetIssuePrd).toHaveBeenCalledWith('my-project', '42');
  });

  it('returns 404 when project not found', async () => {
    mockGetIssuePrd.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const app = makeApp();
    const res = await app.request('/projects/unknown/issues/1/prd', { method: 'GET' });
    expect(res.status).toBe(404);
  });
});

describe('GET /projects/:slug/issues/:id/triage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with triage data on success', async () => {
    const triage = { type: 'bug', priority: 'high', candidates: [] };
    mockGetIssueTriage.mockResolvedValue({ ok: true, data: { triage } });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/triage', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { triage: unknown };
    expect(body.triage).toEqual(triage);
    expect(mockGetIssueTriage).toHaveBeenCalledWith('my-project', '42');
  });

  it('returns 200 with null triage when no triage event exists', async () => {
    mockGetIssueTriage.mockResolvedValue({ ok: true, data: { triage: null } });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/triage', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { triage: null };
    expect(body.triage).toBeNull();
  });

  it('returns 404 when project not found', async () => {
    mockGetIssueTriage.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const app = makeApp();
    const res = await app.request('/projects/unknown/issues/1/triage', { method: 'GET' });
    expect(res.status).toBe(404);
  });
});

describe('GET /projects/:slug/issues/:id/artifacts/:artifactKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with artifact payload on success', async () => {
    const artifact = {
      artifactKey: 'pr-diff:abc',
      projectId: 'my-project',
      workItemId: 'github:owner/repo#42',
      runId: 'run-abc',
      kind: 'pr-diff',
      summary: '1 changed file',
      bytes: 123,
      createdAt: '2026-05-14T00:00:00Z',
      expiresAt: null,
      payload: 'diff --git a/foo.ts b/foo.ts',
    };
    mockGetIssueArtifact.mockResolvedValue({ ok: true, data: { artifact } });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/artifacts/pr-diff:abc', {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { artifact: unknown };
    expect(body.artifact).toEqual(artifact);
    expect(mockGetIssueArtifact).toHaveBeenCalledWith('my-project', '42', 'pr-diff:abc');
  });

  it('returns 404 for unknown or unauthorized artifacts', async () => {
    mockGetIssueArtifact.mockResolvedValue({
      ok: false,
      error: 'artifact not found',
      status: 404,
    });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/artifacts/nope', {
      method: 'GET',
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('artifact not found');
  });
});

describe('GET /projects/:slug/issues/:id/diff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with diff on success', async () => {
    mockGetIssueWorktreeDiff.mockResolvedValue({
      ok: true,
      data: { diff: 'diff --git a/foo.ts b/foo.ts\n', runId: 'run-abc' },
    });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/diff', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { diff: string; runId: string };
    expect(body.runId).toBe('run-abc');
    expect(mockGetIssueWorktreeDiff).toHaveBeenCalledWith('my-project', '42');
  });

  it('returns 200 with null diff when no worktree exists', async () => {
    mockGetIssueWorktreeDiff.mockResolvedValue({
      ok: true,
      data: { diff: null, runId: null, reason: 'no in-flight run for this issue' },
    });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/diff', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { diff: null };
    expect(body.diff).toBeNull();
  });

  it('returns 404 when project not found', async () => {
    mockGetIssueWorktreeDiff.mockResolvedValue({
      ok: false,
      error: 'project not found',
      status: 404,
    });

    const app = makeApp();
    const res = await app.request('/projects/unknown/issues/1/diff', { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid slug', async () => {
    mockGetIssueWorktreeDiff.mockResolvedValue({ ok: false, error: 'invalid slug', status: 400 });

    const app = makeApp();
    const res = await app.request('/projects/bad-slug/issues/1/diff', { method: 'GET' });
    expect(res.status).toBe(400);
  });
});

describe('POST /projects/:slug/issues/:id/transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with transition result on success', async () => {
    mockTransitionIssue.mockResolvedValue({
      ok: true,
      data: { ok: true, from: 'factory:triaging', to: 'factory:accepted' },
    });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/transition', {
      from: 'factory:triaging',
      to: 'factory:accepted',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; from: string; to: string };
    expect(body.from).toBe('factory:triaging');
    expect(body.to).toBe('factory:accepted');
    expect(mockTransitionIssue).toHaveBeenCalledWith(
      'my-project',
      '42',
      'factory:triaging',
      'factory:accepted',
    );
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    expect(mockTransitionIssue).not.toHaveBeenCalled();
  });

  it('returns 400 when service rejects with missing from/to', async () => {
    mockTransitionIssue.mockResolvedValue({
      ok: false,
      error: "missing 'from' or 'to'",
      status: 400,
    });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/transition', {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("missing 'from' or 'to'");
  });

  it('returns 422 with legalTargets when transition is illegal', async () => {
    mockTransitionIssue.mockResolvedValue({
      ok: false,
      error: 'illegal transition',
      status: 422,
      legalTargets: ['factory:accepted', 'factory:rejected'],
    });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/transition', {
      from: 'factory:triaging',
      to: 'factory:done',
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; legalTargets: string[] };
    expect(body.error).toBe('illegal transition');
    expect(body.legalTargets).toEqual(['factory:accepted', 'factory:rejected']);
  });

  it('returns 404 when project not found', async () => {
    mockTransitionIssue.mockResolvedValue({
      ok: false,
      error: 'project not found',
      status: 404,
    });

    const app = makeApp();
    const res = await postJson(app, '/projects/unknown/issues/1/transition', {
      from: 'factory:triaging',
      to: 'factory:accepted',
    });
    expect(res.status).toBe(404);
  });

  it('omits legalTargets key when service does not include it', async () => {
    mockTransitionIssue.mockResolvedValue({
      ok: false,
      error: 'invalid state name',
      status: 400,
    });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/transition', {
      from: 'bad-state',
      to: 'factory:accepted',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; legalTargets?: unknown };
    expect('legalTargets' in body).toBe(false);
  });
});

describe('POST /projects/:slug/issues/:id/comment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts comment and returns 200', async () => {
    mockCommentOnIssue.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/comment', {
      body: 'Great work!',
    });
    expect(res.status).toBe(200);
    expect(mockCommentOnIssue).toHaveBeenCalledWith('my-project', '42', 'Great work!');
  });

  it('returns 400 when body is missing', async () => {
    mockCommentOnIssue.mockResolvedValue({ ok: false, error: 'body is required', status: 400 });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/comment', {});
    expect(res.status).toBe(400);
    const responseBody = (await res.json()) as { error: string };
    expect(responseBody.error).toBe('body is required');
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    expect(mockCommentOnIssue).not.toHaveBeenCalled();
  });

  it('returns 404 when project not found', async () => {
    mockCommentOnIssue.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const app = makeApp();
    const res = await postJson(app, '/projects/unknown/issues/1/comment', { body: 'hello' });
    expect(res.status).toBe(404);
  });
});

describe('POST /projects/:slug/issues/:id/set-milestone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets milestone and returns 200', async () => {
    mockSetIssueMilestone.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/set-milestone', {
      milestoneNumber: 8,
    });
    expect(res.status).toBe(200);
    expect(mockSetIssueMilestone).toHaveBeenCalledWith('my-project', '42', 8);
  });

  it('passes null milestoneNumber when field is absent', async () => {
    mockSetIssueMilestone.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    await postJson(app, '/projects/my-project/issues/42/set-milestone', {});
    expect(mockSetIssueMilestone).toHaveBeenCalledWith('my-project', '42', null);
  });

  it('passes null milestoneNumber when field is explicitly null', async () => {
    mockSetIssueMilestone.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    await postJson(app, '/projects/my-project/issues/42/set-milestone', { milestoneNumber: null });
    expect(mockSetIssueMilestone).toHaveBeenCalledWith('my-project', '42', null);
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/set-milestone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    expect(mockSetIssueMilestone).not.toHaveBeenCalled();
  });

  it('returns 404 when project not found', async () => {
    mockSetIssueMilestone.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const app = makeApp();
    const res = await postJson(app, '/projects/unknown/issues/1/set-milestone', {
      milestoneNumber: 5,
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /projects/:slug/issues/:id/set-label', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets label and returns 200', async () => {
    mockSetIssueLabel.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/set-label', {
      group: 'priority',
      value: 'high',
    });
    expect(res.status).toBe(200);
    expect(mockSetIssueLabel).toHaveBeenCalledWith('my-project', '42', 'priority', 'high');
  });

  it('returns 400 when service rejects invalid group', async () => {
    mockSetIssueLabel.mockResolvedValue({
      ok: false,
      error: 'group must be priority or schedule',
      status: 400,
    });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/set-label', {
      group: 'invalid',
      value: 'high',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/set-label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    expect(mockSetIssueLabel).not.toHaveBeenCalled();
  });

  it('returns 404 when project not found', async () => {
    mockSetIssueLabel.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const app = makeApp();
    const res = await postJson(app, '/projects/unknown/issues/1/set-label', {
      group: 'priority',
      value: 'low',
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /projects/:slug/issues/:id/repo-override', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('overrides repo and returns 200 with triage data', async () => {
    const triage = { type: 'bug', priority: 'high', candidates: [], overrideRepo: 'owner/repo' };
    mockOverrideIssueRepo.mockResolvedValue({ ok: true, data: { triage } });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/repo-override', {
      repo: 'owner/repo',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { triage: unknown };
    expect(body.triage).toEqual(triage);
    expect(mockOverrideIssueRepo).toHaveBeenCalledWith('my-project', '42', 'owner/repo');
  });

  it('returns 200 with null triage when repo is a string but no triage event exists', async () => {
    mockOverrideIssueRepo.mockResolvedValue({ ok: true, data: { triage: null } });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/repo-override', {
      repo: 'owner/repo',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { triage: null };
    expect(body.triage).toBeNull();
  });

  it('returns 400 when repo field is missing (service rejects null)', async () => {
    mockOverrideIssueRepo.mockResolvedValue({ ok: false, error: 'repo is required', status: 400 });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/repo-override', {});
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body (repo becomes null from catch)', async () => {
    mockOverrideIssueRepo.mockResolvedValue({ ok: false, error: 'repo is required', status: 400 });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/repo-override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when project not found', async () => {
    mockOverrideIssueRepo.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const app = makeApp();
    const res = await postJson(app, '/projects/unknown/issues/1/repo-override', { repo: 'a/b' });
    expect(res.status).toBe(404);
  });
});

describe('POST /projects/:slug/issues/:id/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approves issue and returns 200', async () => {
    mockApproveIssue.mockResolvedValue({
      ok: true,
      data: { ok: true, sha: 'abc123', prNumber: 77 },
    });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/approve', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sha: string; prNumber: number };
    expect(body.sha).toBe('abc123');
    expect(body.prNumber).toBe(77);
    expect(mockApproveIssue).toHaveBeenCalledWith('my-project', '42', expect.any(Object));
  });

  it('returns 400 when no PR event found', async () => {
    mockApproveIssue.mockResolvedValue({
      ok: false,
      error: 'no pr.opened event found — cannot approve without a PR',
      status: 400,
    });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/approve', { method: 'POST' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('no pr.opened event found');
  });

  it('returns 404 when project not found', async () => {
    mockApproveIssue.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const app = makeApp();
    const res = await app.request('/projects/unknown/issues/1/approve', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('returns 500 when internal error occurs', async () => {
    mockApproveIssue.mockResolvedValue({
      ok: false,
      error: 'GITHUB_TOKEN env var not set',
      status: 500,
    });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/approve', { method: 'POST' });
    expect(res.status).toBe(500);
  });

  it('returns 409 and calls dispatchResolveConflict when merge conflict detected', async () => {
    mockApproveIssue.mockResolvedValue({
      ok: false,
      error: 'merge-conflict',
      status: 409,
    });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/approve', { method: 'POST' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('merge-conflict');
    expect(mockDispatchResolveConflict).toHaveBeenCalledWith('my-project', 42);
  });
});

describe('POST /projects/:slug/issues/:id/reject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects issue and returns 200', async () => {
    mockRejectIssue.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/reject', {
      reason: 'Does not meet acceptance criteria',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(mockRejectIssue).toHaveBeenCalledWith(
      'my-project',
      '42',
      'Does not meet acceptance criteria',
    );
  });

  it('returns 400 when reason is missing', async () => {
    mockRejectIssue.mockResolvedValue({
      ok: false,
      error: 'rejection reason is required',
      status: 400,
    });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/reject', {});
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    expect(mockRejectIssue).not.toHaveBeenCalled();
  });

  it('returns 404 when project not found', async () => {
    mockRejectIssue.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const app = makeApp();
    const res = await postJson(app, '/projects/unknown/issues/1/reject', { reason: 'bad' });
    expect(res.status).toBe(404);
  });
});

describe('POST /projects/:slug/issues/:id/approve-prd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approves PRD and returns 200', async () => {
    mockApprovePRD.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/approve-prd', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(mockApprovePRD).toHaveBeenCalledWith('my-project', '42');
  });

  it('returns 409 when state is not factory:prd-review', async () => {
    mockApprovePRD.mockResolvedValue({
      ok: false,
      error: 'expected state factory:prd-review, got factory:dev-ready',
      status: 409,
    });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/approve-prd', { method: 'POST' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('expected state factory:prd-review');
  });

  it('returns 404 when project not found', async () => {
    mockApprovePRD.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const app = makeApp();
    const res = await app.request('/projects/unknown/issues/1/approve-prd', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('POST /projects/:slug/issues/:id/reject-prd', () => {
  it('returns 410 Gone (tombstone — use /revise-prd or /decline-prd)', async () => {
    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/reject-prd', { method: 'POST' });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('revise-prd');
    expect(body.error).toContain('decline-prd');
  });
});

describe('POST /projects/:slug/issues/:id/revise-prd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls revisePRD with concerns and returns 200', async () => {
    mockRevisePRD.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/revise-prd', {
      concerns: ['Journey J-1 is unclear'],
    });
    expect(res.status).toBe(200);
    expect(mockRevisePRD).toHaveBeenCalledWith('my-project', '42', ['Journey J-1 is unclear']);
  });

  it('passes empty array when concerns is absent', async () => {
    mockRevisePRD.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/revise-prd', {});
    expect(res.status).toBe(200);
    expect(mockRevisePRD).toHaveBeenCalledWith('my-project', '42', []);
  });

  it('returns 409 when state is not factory:prd-review', async () => {
    mockRevisePRD.mockResolvedValue({
      ok: false,
      error: 'expected state factory:prd-review, got factory:done',
      status: 409,
    });

    const app = makeApp();
    const res = await postJson(app, '/projects/my-project/issues/42/revise-prd', {
      concerns: ['fix this'],
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /projects/:slug/issues/:id/decline-prd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls declinePRD and returns 200', async () => {
    mockDeclinePRD.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/decline-prd', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(mockDeclinePRD).toHaveBeenCalledWith('my-project', '42');
  });

  it('returns 409 when state is not factory:prd-review', async () => {
    mockDeclinePRD.mockResolvedValue({
      ok: false,
      error: 'expected state factory:prd-review, got factory:grilling',
      status: 409,
    });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/decline-prd', { method: 'POST' });
    expect(res.status).toBe(409);
  });
});

describe('POST /projects/:slug/issues/:id/proceed-to-prd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls proceedToPrd and returns 200', async () => {
    mockProceedToPrd.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/proceed-to-prd', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(mockProceedToPrd).toHaveBeenCalledWith('my-project', '42');
  });

  it('returns 409 when state is not factory:gate-pending', async () => {
    mockProceedToPrd.mockResolvedValue({
      ok: false,
      error: 'expected state factory:gate-pending, got factory:grilling',
      status: 409,
    });

    const app = makeApp();
    const res = await app.request('/projects/my-project/issues/42/proceed-to-prd', {
      method: 'POST',
    });
    expect(res.status).toBe(409);
  });
});

describe('GET /:slug/issues/:id/spec', () => {
  it('returns spec when found', async () => {
    mockGetIssueSpec.mockResolvedValue({
      ok: true,
      data: {
        spec: {
          pipelineRunId: 'pipe-abc',
          objective: 'Add feature X',
          workPackages: [{ id: 'WP1', filesOwned: ['src/foo.ts'], builderTier: 'sonnet' }],
          acceptanceCriteriaCount: 3,
        },
      },
    });

    const app = makeApp();
    const res = await app.request('/projects/test-slug/issues/42/spec');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      spec: { objective: string; workPackages: unknown[]; acceptanceCriteriaCount: number };
    };
    expect(body.spec.objective).toBe('Add feature X');
    expect(body.spec.workPackages).toHaveLength(1);
    expect(body.spec.acceptanceCriteriaCount).toBe(3);
  });

  it('returns spec: null when not found', async () => {
    mockGetIssueSpec.mockResolvedValue({ ok: true, data: { spec: null } });

    const app = makeApp();
    const res = await app.request('/projects/test-slug/issues/42/spec');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { spec: null };
    expect(body.spec).toBeNull();
  });

  it('returns 404 when project not found', async () => {
    mockGetIssueSpec.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const app = makeApp();
    const res = await app.request('/projects/test-slug/issues/42/spec');
    expect(res.status).toBe(404);
  });
});
