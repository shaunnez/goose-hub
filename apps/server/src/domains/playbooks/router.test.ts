import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListPlaybooks, mockGetPlaybook, mockCreatePlaybook } = vi.hoisted(() => ({
  mockListPlaybooks: vi.fn(),
  mockGetPlaybook: vi.fn(),
  mockCreatePlaybook: vi.fn(),
}));

vi.mock('./service.js', () => ({
  listPlaybooks: mockListPlaybooks,
  getPlaybook: mockGetPlaybook,
  createPlaybook: mockCreatePlaybook,
}));

vi.mock('@goose-hub/core/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { playbooksRouter } from './router.js';

function makeApp() {
  return new Hono().route('/projects', playbooksRouter);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /projects/:slug/playbooks', () => {
  it('returns playbook summaries', async () => {
    mockListPlaybooks.mockResolvedValue({
      ok: true,
      data: { playbooks: [{ id: 1, projectId: 'p', lifecycleCount: 5 }] },
    });
    const res = await makeApp().request('/projects/p/playbooks');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { playbooks: unknown[] };
    expect(body.playbooks).toHaveLength(1);
  });

  it('falls back to empty array on service failure', async () => {
    mockListPlaybooks.mockResolvedValue({ ok: false, error: 'oops', status: 500 });
    const res = await makeApp().request('/projects/p/playbooks');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { playbooks: unknown[] };
    expect(body.playbooks).toEqual([]);
  });
});

describe('GET /projects/:slug/playbooks/:id', () => {
  it('404s when playbook missing', async () => {
    mockGetPlaybook.mockResolvedValue({ ok: false, error: 'playbook not found', status: 404 });
    const res = await makeApp().request('/projects/p/playbooks/9999');
    expect(res.status).toBe(404);
  });

  it('400s when id is not a number', async () => {
    const res = await makeApp().request('/projects/p/playbooks/abc');
    expect(res.status).toBe(400);
  });

  it('passes the slug to the service so lookups are scoped per project', async () => {
    mockGetPlaybook.mockResolvedValue({
      ok: true,
      data: { playbook: { id: 1, manifest: { lifecycleCount: 3 } } },
    });
    const res = await makeApp().request('/projects/project-a/playbooks/1');
    expect(res.status).toBe(200);
    expect(mockGetPlaybook).toHaveBeenCalledWith('project-a', 1);
  });

  it('404s when the slug does not match the playbook owner (cross-project leak prevention)', async () => {
    mockGetPlaybook.mockResolvedValue({ ok: false, error: 'playbook not found', status: 404 });
    const res = await makeApp().request('/projects/project-b/playbooks/1');
    expect(res.status).toBe(404);
    expect(mockGetPlaybook).toHaveBeenCalledWith('project-b', 1);
  });
});

describe('POST /projects/:slug/playbooks', () => {
  it('returns 400 for invalid JSON body', async () => {
    const res = await makeApp().request('/projects/p/playbooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    expect(mockCreatePlaybook).not.toHaveBeenCalled();
  });

  it('returns 400 when service rejects with input error', async () => {
    mockCreatePlaybook.mockResolvedValue({
      ok: false,
      error: 'exactly one of windowSize or dateRange must be supplied',
      status: 400,
    });
    const res = await makeApp().request('/projects/p/playbooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('forwards windowSize to the service', async () => {
    mockCreatePlaybook.mockResolvedValue({
      ok: true,
      data: { playbookId: 7, lifecycleCount: 4 },
    });
    const res = await makeApp().request('/projects/goose-hub-self/playbooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windowSize: 5 }),
    });
    expect(res.status).toBe(201);
    expect(mockCreatePlaybook).toHaveBeenCalledWith(
      'goose-hub-self',
      expect.objectContaining({ windowSize: 5 }),
    );
  });

  it('forwards a complete dateRange to the service', async () => {
    mockCreatePlaybook.mockResolvedValue({
      ok: true,
      data: { playbookId: 7, lifecycleCount: 4 },
    });
    await makeApp().request('/projects/p/playbooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRange: { startAt: '2026-04-01T00:00:00Z', endAt: '2026-05-01T00:00:00Z' },
      }),
    });
    expect(mockCreatePlaybook).toHaveBeenCalledWith(
      'p',
      expect.objectContaining({
        dateRange: { startAt: '2026-04-01T00:00:00Z', endAt: '2026-05-01T00:00:00Z' },
      }),
    );
  });

  it('drops partial dateRange (missing endAt) so the workflow input validator rejects it', async () => {
    mockCreatePlaybook.mockResolvedValue({
      ok: false,
      error: 'exactly one of windowSize or dateRange must be supplied',
      status: 400,
    });
    await makeApp().request('/projects/p/playbooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateRange: { startAt: '2026-04-01T00:00:00Z' } }),
    });
    const callArg = mockCreatePlaybook.mock.calls[0][1];
    expect(callArg.dateRange).toBeUndefined();
  });
});
