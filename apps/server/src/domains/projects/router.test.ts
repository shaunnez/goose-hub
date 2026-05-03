import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ──────────────────────────────────────────────────────────────

const { mockListProjectsService } = vi.hoisted(() => ({
  mockListProjectsService: vi.fn(),
}));

vi.mock('./service.js', () => ({
  listProjectsService: mockListProjectsService,
}));

import { projectsRouter } from './router.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

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
