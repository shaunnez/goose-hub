import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── module mocks ──────────────────────────────────────────────────────────────

const { mockRunTriageBatch, mockRunQaBatch, mockRunReviewBatch, mockRunRetroBatch } = vi.hoisted(
  () => ({
    mockRunTriageBatch: vi.fn().mockResolvedValue(undefined),
    mockRunQaBatch: vi.fn().mockResolvedValue(undefined),
    mockRunReviewBatch: vi.fn().mockResolvedValue(undefined),
    mockRunRetroBatch: vi.fn().mockResolvedValue(undefined),
  }),
);

vi.mock('./triage-batch.js', () => ({ runTriageBatch: mockRunTriageBatch }));
vi.mock('./qa-batch.js', () => ({ runQaBatch: mockRunQaBatch }));
vi.mock('./review-batch.js', () => ({ runReviewBatch: mockRunReviewBatch }));
vi.mock('./retro-batch.js', () => ({
  runRetroBatch: mockRunRetroBatch,
  runRetroForItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@goose-hub/core/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { workflowsRouter } = await import('./router.js');

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeApp() {
  return new Hono().route('/projects', workflowsRouter);
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('POST /projects/:slug/tick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with ok:true and slug', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/tick', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; slug: string };
    expect(body.ok).toBe(true);
    expect(body.slug).toBe('goose-hub-self');
  });

  it('awaits runTriageBatch before responding', async () => {
    const app = makeApp();
    const res = await app.request('/projects/my-project/tick', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(mockRunTriageBatch).toHaveBeenCalledWith('my-project');
  });

  it('returns 500 when runTriageBatch rejects', async () => {
    mockRunTriageBatch.mockRejectedValueOnce(new Error('batch error'));
    const app = makeApp();
    const res = await app.request('/projects/my-project/tick', { method: 'POST' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});

describe('POST /projects/:slug/run-qa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 202 with ok:true and slug', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/run-qa', { method: 'POST' });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean; slug: string };
    expect(body.ok).toBe(true);
    expect(body.slug).toBe('goose-hub-self');
  });

  it('fires runQaBatch asynchronously', async () => {
    const app = makeApp();
    await app.request('/projects/qa-proj/run-qa', { method: 'POST' });
    await vi.waitFor(() => expect(mockRunQaBatch).toHaveBeenCalledWith('qa-proj'));
  });

  it('still returns 202 even when runQaBatch rejects', async () => {
    mockRunQaBatch.mockRejectedValueOnce(new Error('qa error'));
    const app = makeApp();
    const res = await app.request('/projects/qa-proj/run-qa', { method: 'POST' });
    expect(res.status).toBe(202);
  });
});

describe('POST /projects/:slug/run-review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 202 with ok:true and slug', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/run-review', { method: 'POST' });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean; slug: string };
    expect(body.ok).toBe(true);
    expect(body.slug).toBe('goose-hub-self');
  });

  it('fires runReviewBatch asynchronously', async () => {
    const app = makeApp();
    await app.request('/projects/review-proj/run-review', { method: 'POST' });
    await vi.waitFor(() => expect(mockRunReviewBatch).toHaveBeenCalledWith('review-proj'));
  });

  it('still returns 202 even when runReviewBatch rejects', async () => {
    mockRunReviewBatch.mockRejectedValueOnce(new Error('review error'));
    const app = makeApp();
    const res = await app.request('/projects/review-proj/run-review', { method: 'POST' });
    expect(res.status).toBe(202);
  });
});

describe('POST /projects/:slug/run-retro', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 202 with ok:true and slug', async () => {
    const app = makeApp();
    const res = await app.request('/projects/goose-hub-self/run-retro', { method: 'POST' });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean; slug: string };
    expect(body.ok).toBe(true);
    expect(body.slug).toBe('goose-hub-self');
  });

  it('fires runRetroBatch asynchronously', async () => {
    const app = makeApp();
    await app.request('/projects/retro-proj/run-retro', { method: 'POST' });
    await vi.waitFor(() => expect(mockRunRetroBatch).toHaveBeenCalledWith('retro-proj'));
  });

  it('still returns 202 even when runRetroBatch rejects', async () => {
    mockRunRetroBatch.mockRejectedValueOnce(new Error('retro error'));
    const app = makeApp();
    const res = await app.request('/projects/retro-proj/run-retro', { method: 'POST' });
    expect(res.status).toBe(202);
  });
});
