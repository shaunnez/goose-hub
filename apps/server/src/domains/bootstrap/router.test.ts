import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockActivate, mockCreateLocal, mockPreview, mockPreviewLocal, mockRun } = vi.hoisted(
  () => ({
    mockActivate: vi.fn(),
    mockCreateLocal: vi.fn(),
    mockPreview: vi.fn(),
    mockPreviewLocal: vi.fn(),
    mockRun: vi.fn(),
  }),
);

vi.mock('./service.js', () => ({
  activateLocalDbProject: mockActivate,
  createLocalProjectService: mockCreateLocal,
  previewBootstrapService: mockPreview,
  previewLocalProjectCreationService: mockPreviewLocal,
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
        name: 'widgets',
        defaultBranch: 'main',
        repos: [],
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
    expect(mockPreview).toHaveBeenCalledWith({ repoRef: 'octo/widgets' });
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
    expect(mockPreview).toHaveBeenCalledWith({});
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
    expect(mockRun).toHaveBeenCalledWith({ repoRef: 'octo/widgets' });
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
    expect(mockRun).toHaveBeenCalledWith({ repoRef: 'octo/widgets', slug: 'custom' });
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

describe('POST /projects/bootstrap/local-project/preview', () => {
  it('returns 200 with the generated config preview', async () => {
    mockPreviewLocal.mockResolvedValue({
      ok: true,
      data: {
        slug: 'widgets',
        name: 'widgets',
        configPath: 'target-projects/widgets/project.config.ts',
        config: 'const config = {}',
        requiredEnvVars: [],
        repositories: [],
        integrations: ['github'],
      },
    });

    const app = makeApp();
    const res = await app.request('/projects/bootstrap/local-project/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { kind: 'github-code', repoRefs: ['octo/widgets'] } }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ slug: 'widgets' });
    expect(mockPreviewLocal).toHaveBeenCalledWith({
      source: { kind: 'github-code', repoRefs: ['octo/widgets'] },
    });
  });

  it('returns the service status code on failure', async () => {
    mockPreviewLocal.mockResolvedValue({ ok: false, error: 'bad source', status: 400 });
    const app = makeApp();
    const res = await app.request('/projects/bootstrap/local-project/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { kind: 'advanced' } }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad source' });
  });
});

describe('POST /projects/bootstrap/local-project/create', () => {
  it('returns 200 with the local write result', async () => {
    mockCreateLocal.mockResolvedValue({
      ok: true,
      data: {
        status: 'created',
        slug: 'widgets',
        name: 'widgets',
        configPath: 'target-projects/widgets/project.config.ts',
        writtenPath: '/repo/target-projects/widgets/project.config.ts',
        config: 'const config = {}',
        requiredEnvVars: [],
        repositories: [],
        integrations: [],
      },
    });

    const app = makeApp();
    const res = await app.request('/projects/bootstrap/local-project/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'widgets', source: { kind: 'local-only' } }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'created', slug: 'widgets' });
    expect(mockCreateLocal).toHaveBeenCalledWith({
      slug: 'widgets',
      source: { kind: 'local-only' },
    });
  });

  it('supports conflict responses', async () => {
    mockCreateLocal.mockResolvedValue({ ok: false, error: 'exists', status: 409 });
    const app = makeApp();
    const res = await app.request('/projects/bootstrap/local-project/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'widgets', source: { kind: 'local-only' } }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'exists' });
  });
});

describe('POST /projects/bootstrap/activate', () => {
  it('activates a merged local-db project by slug', async () => {
    mockActivate.mockResolvedValue({
      ok: true,
      data: {
        slug: 'widgets',
        reposLinked: 1,
        issuesImported: 2,
        issuesUpdated: 0,
        issuesSkipped: 0,
        mirrorLabels: true,
      },
    });

    const app = makeApp();
    const res = await app.request('/projects/bootstrap/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'widgets' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ issuesImported: 2, mirrorLabels: true });
    expect(mockActivate).toHaveBeenCalledWith('widgets');
  });

  it('requires slug for activation', async () => {
    const app = makeApp();
    const res = await app.request('/projects/bootstrap/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(mockActivate).not.toHaveBeenCalled();
  });
});
