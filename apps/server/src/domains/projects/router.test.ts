import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ──────────────────────────────────────────────────────────────

const { mockListProjectsService, mockCoachSkillService } = vi.hoisted(() => ({
  mockListProjectsService: vi.fn(),
  mockCoachSkillService: vi.fn(),
}));

vi.mock('./service.js', () => ({
  listProjectsService: mockListProjectsService,
  coachSkillService: mockCoachSkillService,
}));

import { projectsRouter } from './router.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeApp() {
  return new Hono().route('/', projectsRouter);
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with { ok: true }', async () => {
    const app = makeApp();
    const res = await app.request('/health', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe('GET /projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with projects list from service', async () => {
    const projects = [
      { id: 'proj-1', name: 'Project One' },
      { id: 'proj-2', name: 'Project Two' },
    ];
    mockListProjectsService.mockResolvedValue({ projects });

    const app = makeApp();
    const res = await app.request('/projects', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: unknown[] };
    expect(body.projects).toEqual(projects);
    expect(mockListProjectsService).toHaveBeenCalledTimes(1);
  });

  it('returns 200 with empty projects list when service returns empty array', async () => {
    mockListProjectsService.mockResolvedValue({ projects: [] });

    const app = makeApp();
    const res = await app.request('/projects', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: unknown[] };
    expect(body.projects).toEqual([]);
  });
});

describe('POST /projects/:slug/coach', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts valid targetSkillName and patternIds', async () => {
    mockCoachSkillService.mockResolvedValue({ ok: true });

    const app = makeApp();
    const res = await app.request('/projects/test-project/coach', {
      method: 'POST',
      body: JSON.stringify({
        targetSkillName: 'investigate',
        patternIds: ['p1', 'p2'],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(mockCoachSkillService).toHaveBeenCalledWith('test-project', {
      targetSkillName: 'investigate',
      patternIds: ['p1', 'p2'],
      lifecycleIds: undefined,
    });
  });

  it('accepts optional lifecycleIds', async () => {
    mockCoachSkillService.mockResolvedValue({ ok: true });

    const app = makeApp();
    const res = await app.request('/projects/test-project/coach', {
      method: 'POST',
      body: JSON.stringify({
        targetSkillName: 'investigate',
        patternIds: ['p1'],
        lifecycleIds: ['l1', 'l2'],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(mockCoachSkillService).toHaveBeenCalledWith('test-project', {
      targetSkillName: 'investigate',
      patternIds: ['p1'],
      lifecycleIds: ['l1', 'l2'],
    });
  });

  it('returns 400 when targetSkillName is missing', async () => {
    const app = makeApp();
    const res = await app.request('/projects/test-project/coach', {
      method: 'POST',
      body: JSON.stringify({ patternIds: ['p1'] }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when patternIds is missing', async () => {
    const app = makeApp();
    const res = await app.request('/projects/test-project/coach', {
      method: 'POST',
      body: JSON.stringify({ targetSkillName: 'investigate' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when patternIds is not an array', async () => {
    const app = makeApp();
    const res = await app.request('/projects/test-project/coach', {
      method: 'POST',
      body: JSON.stringify({
        targetSkillName: 'investigate',
        patternIds: 'p1',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});
