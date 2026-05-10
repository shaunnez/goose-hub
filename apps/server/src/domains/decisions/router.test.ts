import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@goose-hub/core/tool-layer/tools/record-decision.js', () => ({
  recordDecision: vi.fn().mockReturnValue({ recorded: true, id: 'test-id' }),
}));

import { recordDecision } from '@goose-hub/core/tool-layer/tools/record-decision.js';
import { decisionsRouter } from './router.js';

describe('POST /api/decisions', () => {
  beforeEach(() => {
    vi.mocked(recordDecision).mockClear();
    vi.mocked(recordDecision).mockReturnValue({ recorded: true, id: 'test-id' });
  });

  it('accepts valid body and calls recordDecision', async () => {
    const app = new Hono().route('/api/decisions', decisionsRouter);
    const res = await app.request('/api/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-abc',
        projectId: 'proj-1',
        kind: 'IMPLEMENTATION_PLAN',
        what: 'Add validation in handler',
        why: 'Request body is untrusted input',
        iteration: 0,
        phase: 'implement',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; recorded: boolean };
    expect(body.ok).toBe(true);
    expect(recordDecision).toHaveBeenCalledTimes(1);
    const call = vi.mocked(recordDecision).mock.calls[0][0];
    expect(call.runId).toBe('run-abc');
    expect(call.kind).toBe('IMPLEMENTATION_PLAN');
    expect(call.what).toBe('Add validation in handler');
    expect(call.why).toBe('Request body is untrusted input');
    expect(call.iteration).toBe(0);
    expect(call.phase).toBe('implement');
  });

  it('accepts body without optional iteration/phase', async () => {
    const app = new Hono().route('/api/decisions', decisionsRouter);
    const res = await app.request('/api/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-abc',
        projectId: 'proj-1',
        kind: 'REPO_SELECTION',
        what: 'Selected payments-api',
        why: 'Keyword match on payments',
      }),
    });
    expect(res.status).toBe(200);
    expect(recordDecision).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when runId is missing', async () => {
    const app = new Hono().route('/api/decisions', decisionsRouter);
    const res = await app.request('/api/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-1',
        kind: 'IMPLEMENTATION_PLAN',
        what: 'something',
        why: 'because',
      }),
    });
    expect(res.status).toBe(400);
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it('returns 400 when what is missing', async () => {
    const app = new Hono().route('/api/decisions', decisionsRouter);
    const res = await app.request('/api/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-abc',
        projectId: 'proj-1',
        kind: 'IMPLEMENTATION_PLAN',
        why: 'because',
      }),
    });
    expect(res.status).toBe(400);
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it('returns 400 when why is missing', async () => {
    const app = new Hono().route('/api/decisions', decisionsRouter);
    const res = await app.request('/api/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-abc',
        projectId: 'proj-1',
        kind: 'IMPLEMENTATION_PLAN',
        what: 'something',
      }),
    });
    expect(res.status).toBe(400);
    expect(recordDecision).not.toHaveBeenCalled();
  });

  it('returns 200 with recorded=false on duplicate', async () => {
    vi.mocked(recordDecision).mockReturnValue({
      recorded: false,
      id: 'existing-id',
      reason: 'duplicate',
    });
    const app = new Hono().route('/api/decisions', decisionsRouter);
    const res = await app.request('/api/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-abc',
        projectId: 'proj-1',
        kind: 'REPO_SELECTION',
        what: 'already recorded',
        why: 'duplicate',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; recorded: boolean };
    expect(body.recorded).toBe(false);
  });
});
