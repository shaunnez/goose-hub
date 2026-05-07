import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPreview, mockRun } = vi.hoisted(() => ({
  mockPreview: vi.fn(),
  mockRun: vi.fn(),
}));

vi.mock('./service.js', () => ({
  previewBootstrapService: mockPreview,
  runBootstrapService: mockRun,
}));

import { bootstrapRouter } from './router.js';

function makeApp() {
  return new Hono().route('/projects', bootstrapRouter);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /projects/bootstrap/preview', () => {
  it('returns 200 with the preview DTO from the service', async () => {
    mockPreview.mockResolvedValue({
      ok: true,
      data: {
        slug: 'widgets',
        defaultBranch: 'main',
        stack: { type: 'node', summary: 'node (pnpm)', raw: {} },
        audit: { action: 'create', content: '...', rationale: '...' },
        labelsToInstall: [{ name: 'factory:done', color: 'd1d5db', description: 'Done' }],
      },
    });
    const app = makeApp();
    const res = await app.request('/projects/bootstrap/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoRef: 'octo/widgets' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slug: string };
    expect(body.slug).toBe('widgets');
    expect(mockPreview).toHaveBeenCalledWith('octo/widgets');
  });

  it('returns the service status code on failure', async () => {
    mockPreview.mockResolvedValue({
      ok: false,
      error: 'repo not found',
      status: 404,
    });
    const app = makeApp();
    const res = await app.request('/projects/bootstrap/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoRef: 'octo/missing' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('repo not found');
  });

  it('returns 400 when the body is missing repoRef', async () => {
    mockPreview.mockResolvedValue({
      ok: false,
      error: 'repoRef is required',
      status: 400,
    });
    const app = makeApp();
    const res = await app.request('/projects/bootstrap/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(mockPreview).toHaveBeenCalledWith('');
  });
});

describe('POST /projects/bootstrap/run', () => {
  it('returns 200 with the workflow result', async () => {
    mockRun.mockResolvedValue({
      ok: true,
      data: {
        status: 'created',
        registrationPrUrl: 'https://github.com/shaunnez/goose-hub/pull/100',
        slug: 'widgets',
        stackSummary: 'node (pnpm)',
        auditAction: 'create',
        labelCounts: { created: 1, updated: 0, skipped: 0 },
      },
    });
    const app = makeApp();
    const res = await app.request('/projects/bootstrap/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoRef: 'octo/widgets' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { registrationPrUrl: string };
    expect(body.registrationPrUrl).toContain('pull/100');
    expect(mockRun).toHaveBeenCalledWith('octo/widgets', undefined);
  });

  it('forwards a slug override', async () => {
    mockRun.mockResolvedValue({
      ok: true,
      data: {
        status: 'created',
        registrationPrUrl: 'https://github.com/shaunnez/goose-hub/pull/101',
        slug: 'custom',
        stackSummary: 'node',
        auditAction: 'ok',
      },
    });
    const app = makeApp();
    const res = await app.request('/projects/bootstrap/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoRef: 'octo/widgets', slug: 'custom' }),
    });
    expect(res.status).toBe(200);
    expect(mockRun).toHaveBeenCalledWith('octo/widgets', 'custom');
  });

  it('returns the service error status on failure', async () => {
    mockRun.mockResolvedValue({
      ok: false,
      error: 'workflow exploded',
      status: 500,
    });
    const app = makeApp();
    const res = await app.request('/projects/bootstrap/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoRef: 'octo/widgets' }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('workflow exploded');
  });
});
