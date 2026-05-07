import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ──────────────────────────────────────────────────────────────

const {
  mockListMilestones,
  mockListMilestoneIssues,
  mockListClosedMilestoneIssues,
  mockGetActiveMilestone,
  mockSetActiveMilestone,
  mockTriggerSprintReview,
} = vi.hoisted(() => ({
  mockListMilestones: vi.fn(),
  mockListMilestoneIssues: vi.fn(),
  mockListClosedMilestoneIssues: vi.fn(),
  mockGetActiveMilestone: vi.fn(),
  mockSetActiveMilestone: vi.fn(),
  mockTriggerSprintReview: vi.fn(),
}));

vi.mock('./service.js', () => ({
  listMilestones: mockListMilestones,
  listMilestoneIssues: mockListMilestoneIssues,
  listClosedMilestoneIssues: mockListClosedMilestoneIssues,
  getActiveMilestone: mockGetActiveMilestone,
  setActiveMilestone: mockSetActiveMilestone,
  triggerSprintReview: mockTriggerSprintReview,
}));

vi.mock('@goose-hub/core/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { milestonesRouter } from './router.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  return new Hono().route('/projects', milestonesRouter);
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('GET /projects/:slug/milestones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with milestones on success', async () => {
    const milestones = [
      { number: 1, title: 'M1' },
      { number: 2, title: 'M2' },
    ];
    mockListMilestones.mockResolvedValue({ ok: true, data: { milestones } });

    const app = makeApp();
    const res = await app.request('/projects/my-project/milestones', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { milestones: unknown[] };
    expect(body.milestones).toEqual(milestones);
    expect(mockListMilestones).toHaveBeenCalledWith('my-project');
  });

  it('returns 404 when project not found', async () => {
    mockListMilestones.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const app = makeApp();
    const res = await app.request('/projects/unknown-slug/milestones', { method: 'GET' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('project not found');
  });
});

describe('GET /projects/:slug/milestones/:milestone/issues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with items on success', async () => {
    const items = [{ id: 'issue-1' }, { id: 'issue-2' }];
    mockListMilestoneIssues.mockResolvedValue({ ok: true, data: { items } });

    const app = makeApp();
    const res = await app.request('/projects/my-project/milestones/8/issues', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual(items);
    expect(mockListMilestoneIssues).toHaveBeenCalledWith('my-project', 8);
  });

  it('returns 400 when milestone param is not a number', async () => {
    const app = makeApp();
    const res = await app.request('/projects/my-project/milestones/abc/issues', { method: 'GET' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid milestone number');
    expect(mockListMilestoneIssues).not.toHaveBeenCalled();
  });

  it('returns 404 when project not found', async () => {
    mockListMilestoneIssues.mockResolvedValue({
      ok: false,
      error: 'project not found',
      status: 404,
    });

    const app = makeApp();
    const res = await app.request('/projects/unknown/milestones/3/issues', { method: 'GET' });
    expect(res.status).toBe(404);
  });
});

describe('GET /projects/:slug/milestones/:milestone/closed-issues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with closed items on success', async () => {
    const items = [{ id: 'closed-1' }];
    mockListClosedMilestoneIssues.mockResolvedValue({ ok: true, data: { items } });

    const app = makeApp();
    const res = await app.request('/projects/my-project/milestones/8/closed-issues', {
      method: 'GET',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual(items);
    expect(mockListClosedMilestoneIssues).toHaveBeenCalledWith('my-project', 8);
  });

  it('returns 400 when milestone param is not a number', async () => {
    const app = makeApp();
    const res = await app.request('/projects/my-project/milestones/nan/closed-issues', {
      method: 'GET',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid milestone number');
    expect(mockListClosedMilestoneIssues).not.toHaveBeenCalled();
  });

  it('returns 404 when project not found', async () => {
    mockListClosedMilestoneIssues.mockResolvedValue({
      ok: false,
      error: 'project not found',
      status: 404,
    });

    const app = makeApp();
    const res = await app.request('/projects/unknown/milestones/3/closed-issues', {
      method: 'GET',
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /projects/:slug/active-milestone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with active milestone data', async () => {
    mockGetActiveMilestone.mockResolvedValue({
      ok: true,
      data: { milestoneNumber: 8, source: 'project_state' },
    });

    const app = makeApp();
    const res = await app.request('/projects/my-project/active-milestone', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { milestoneNumber: number; source: string };
    expect(body.milestoneNumber).toBe(8);
    expect(body.source).toBe('project_state');
    expect(mockGetActiveMilestone).toHaveBeenCalledWith('my-project');
  });

  it('returns 404 when project not found', async () => {
    mockGetActiveMilestone.mockResolvedValue({
      ok: false,
      error: 'project not found',
      status: 404,
    });

    const app = makeApp();
    const res = await app.request('/projects/unknown/active-milestone', { method: 'GET' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('project not found');
  });

  it('returns 200 with null milestoneNumber when no active milestone is set', async () => {
    mockGetActiveMilestone.mockResolvedValue({
      ok: true,
      data: { milestoneNumber: null, source: 'github-default' },
    });

    const app = makeApp();
    const res = await app.request('/projects/my-project/active-milestone', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { milestoneNumber: null };
    expect(body.milestoneNumber).toBeNull();
  });
});

describe('POST /projects/:slug/active-milestone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets active milestone and returns 200 with result', async () => {
    mockSetActiveMilestone.mockResolvedValue({
      ok: true,
      data: { ok: true, milestoneNumber: 9 },
    });

    const app = makeApp();
    const res = await app.request('/projects/my-project/active-milestone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestoneNumber: 9 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; milestoneNumber: number };
    expect(body.ok).toBe(true);
    expect(body.milestoneNumber).toBe(9);
    expect(mockSetActiveMilestone).toHaveBeenCalledWith('my-project', 9);
  });

  it('passes null milestoneNumber when field is absent from body', async () => {
    mockSetActiveMilestone.mockResolvedValue({
      ok: true,
      data: { ok: true, milestoneNumber: null },
    });

    const app = makeApp();
    const res = await app.request('/projects/my-project/active-milestone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(mockSetActiveMilestone).toHaveBeenCalledWith('my-project', null);
  });

  it('passes null milestoneNumber when field is explicitly null', async () => {
    mockSetActiveMilestone.mockResolvedValue({
      ok: true,
      data: { ok: true, milestoneNumber: null },
    });

    const app = makeApp();
    await app.request('/projects/my-project/active-milestone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestoneNumber: null }),
    });
    expect(mockSetActiveMilestone).toHaveBeenCalledWith('my-project', null);
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = makeApp();
    const res = await app.request('/projects/my-project/active-milestone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    expect(mockSetActiveMilestone).not.toHaveBeenCalled();
  });

  it('returns 404 when project not found', async () => {
    mockSetActiveMilestone.mockResolvedValue({
      ok: false,
      error: 'project not found',
      status: 404,
    });

    const app = makeApp();
    const res = await app.request('/projects/unknown/active-milestone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestoneNumber: 5 }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('project not found');
  });
});

describe('POST /projects/:slug/milestones/:title/sprint-review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with issueNumber on success', async () => {
    mockTriggerSprintReview.mockResolvedValue({ ok: true, data: { issueNumber: 42 } });

    const app = makeApp();
    const res = await app.request(
      '/projects/my-project/milestones/M13%3A%20Subagents/sprint-review',
      { method: 'POST' },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { issueNumber: number };
    expect(body.issueNumber).toBe(42);
    expect(mockTriggerSprintReview).toHaveBeenCalledWith('my-project', 'M13: Subagents');
  });

  it('returns 409 when sprint-review issue already exists', async () => {
    mockTriggerSprintReview.mockResolvedValue({
      ok: false,
      error: 'sprint-review issue already exists for this milestone',
      status: 409,
    });

    const app = makeApp();
    const res = await app.request(
      '/projects/my-project/milestones/M13%3A%20Subagents/sprint-review',
      { method: 'POST' },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('already exists');
  });

  it('returns 404 when project not found', async () => {
    mockTriggerSprintReview.mockResolvedValue({
      ok: false,
      error: 'project not found',
      status: 404,
    });

    const app = makeApp();
    const res = await app.request('/projects/unknown/milestones/M13%3A%20Subagents/sprint-review', {
      method: 'POST',
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('project not found');
  });
});
