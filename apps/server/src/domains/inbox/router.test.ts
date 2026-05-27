import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ──────────────────────────────────────────────────────────────

const { mockCreateInboxItem, mockGetInboxItems, mockPromoteInboxItem, mockDeleteInboxItem } =
  vi.hoisted(() => ({
    mockCreateInboxItem: vi.fn(),
    mockGetInboxItems: vi.fn(),
    mockPromoteInboxItem: vi.fn(),
    mockDeleteInboxItem: vi.fn(),
  }));

vi.mock('./service.js', () => ({
  createInboxItem: mockCreateInboxItem,
  getInboxItems: mockGetInboxItems,
  promoteInboxItem: mockPromoteInboxItem,
  deleteInboxItem: mockDeleteInboxItem,
}));

vi.mock('@goose-hub/core/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { inboxRouter } from './router.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  return new Hono().route('/inbox', inboxRouter);
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('POST /inbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates inbox item and returns 201', async () => {
    const item = { id: 1, title: 'New feature', body: 'details', type: 'feature' };
    mockCreateInboxItem.mockResolvedValue({ ok: true, data: { item } });

    const app = makeApp();
    const res = await app.request('/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New feature', body: 'details', type: 'feature' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: unknown };
    expect(body.item).toEqual(item);
    expect(mockCreateInboxItem).toHaveBeenCalledWith('New feature', 'details', 'feature');
  });

  it('returns 400 when service rejects a valid payload', async () => {
    mockCreateInboxItem.mockResolvedValue({ ok: false, error: 'duplicate title', status: 400 });

    const app = makeApp();
    const res = await app.request('/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Existing title', body: 'details', type: 'feature' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('duplicate title');
    expect(mockCreateInboxItem).toHaveBeenCalledWith('Existing title', 'details', 'feature');
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = makeApp();
    const res = await app.request('/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    expect(mockCreateInboxItem).not.toHaveBeenCalled();
  });

  it('returns 400 for JSON null body without calling the service', async () => {
    const app = makeApp();
    const res = await app.request('/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid request body');
    expect(mockCreateInboxItem).not.toHaveBeenCalled();
  });

  it('returns the existing title validation error for missing title', async () => {
    const app = makeApp();
    const res = await app.request('/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'no title here' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('title is required');
    expect(mockCreateInboxItem).not.toHaveBeenCalled();
  });

  it('passes unknown type values through so the service can normalize them', async () => {
    mockCreateInboxItem.mockResolvedValue({ ok: true, data: { item: { id: 1 } } });

    const app = makeApp();
    const res = await app.request('/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Needs triage', body: 'details', type: 'unexpected-type' }),
    });

    expect(res.status).toBe(201);
    expect(mockCreateInboxItem).toHaveBeenCalledWith('Needs triage', 'details', 'unexpected-type');
  });
});

describe('GET /inbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with items when service succeeds', async () => {
    const items = [
      { id: 1, title: 'Item A' },
      { id: 2, title: 'Item B' },
    ];
    mockGetInboxItems.mockResolvedValue({ ok: true, data: { items } });

    const app = makeApp();
    const res = await app.request('/inbox', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual(items);
    expect(mockGetInboxItems).toHaveBeenCalledTimes(1);
  });

  it('returns 200 with empty items array when service fails', async () => {
    mockGetInboxItems.mockResolvedValue({ ok: false, error: 'db error', status: 500 });

    const app = makeApp();
    const res = await app.request('/inbox', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });
});

describe('POST /inbox/:id/promote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('promotes inbox item and returns 200', async () => {
    mockPromoteInboxItem.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    const res = await app.request('/inbox/42/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectSlug: 'goose-hub-self' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(mockPromoteInboxItem).toHaveBeenCalledWith(42, 'goose-hub-self', undefined, false);
  });

  it('uses default slug "goose-hub-self" when projectSlug is not provided', async () => {
    mockPromoteInboxItem.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    await app.request('/inbox/7/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(mockPromoteInboxItem).toHaveBeenCalledWith(7, 'goose-hub-self', undefined, false);
  });

  it('passes milestoneNumber to service when provided', async () => {
    mockPromoteInboxItem.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    await app.request('/inbox/10/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectSlug: 'my-proj', milestoneNumber: 5 }),
    });
    expect(mockPromoteInboxItem).toHaveBeenCalledWith(10, 'my-proj', 5, false);
  });

  it('passes null milestoneNumber to service when explicitly set to null', async () => {
    mockPromoteInboxItem.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    await app.request('/inbox/11/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectSlug: 'my-proj', milestoneNumber: null }),
    });
    expect(mockPromoteInboxItem).toHaveBeenCalledWith(11, 'my-proj', null, false);
  });

  it('passes enhance: true to service when explicitly set', async () => {
    mockPromoteInboxItem.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    await app.request('/inbox/12/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectSlug: 'my-proj', enhance: true }),
    });
    expect(mockPromoteInboxItem).toHaveBeenCalledWith(12, 'my-proj', undefined, true);
  });

  it('returns 400 for non-numeric id', async () => {
    const app = makeApp();
    const res = await app.request('/inbox/not-a-number/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid id');
    expect(mockPromoteInboxItem).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = makeApp();
    const res = await app.request('/inbox/5/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    expect(mockPromoteInboxItem).not.toHaveBeenCalled();
  });

  it('returns 404 when item not found', async () => {
    mockPromoteInboxItem.mockResolvedValue({ ok: false, error: 'not found', status: 404 });

    const app = makeApp();
    const res = await app.request('/inbox/999/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not found');
  });

  it('returns 404 when project not found', async () => {
    mockPromoteInboxItem.mockResolvedValue({ ok: false, error: 'project not found', status: 404 });

    const app = makeApp();
    const res = await app.request('/inbox/5/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectSlug: 'unknown-slug' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /inbox/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 on success', async () => {
    mockDeleteInboxItem.mockResolvedValue({ ok: true, data: { ok: true } });

    const app = makeApp();
    const res = await app.request('/inbox/7', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(mockDeleteInboxItem).toHaveBeenCalledWith(7);
  });

  it('returns 400 for non-numeric id', async () => {
    const app = makeApp();
    const res = await app.request('/inbox/not-a-number', { method: 'DELETE' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid id');
    expect(mockDeleteInboxItem).not.toHaveBeenCalled();
  });

  it('returns 404 when item not found', async () => {
    mockDeleteInboxItem.mockResolvedValue({ ok: false, error: 'not found', status: 404 });

    const app = makeApp();
    const res = await app.request('/inbox/999', { method: 'DELETE' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not found');
  });
});
