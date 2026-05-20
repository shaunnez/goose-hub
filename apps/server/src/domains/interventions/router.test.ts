import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListProjectInterventions,
  mockListIssueInterventions,
  mockGetInterventionDetail,
  mockDecideIntervention,
} = vi.hoisted(() => ({
  mockListProjectInterventions: vi.fn(),
  mockListIssueInterventions: vi.fn(),
  mockGetInterventionDetail: vi.fn(),
  mockDecideIntervention: vi.fn(),
}));

vi.mock('./service.js', () => ({
  listProjectInterventions: mockListProjectInterventions,
  listIssueInterventions: mockListIssueInterventions,
  getInterventionDetail: mockGetInterventionDetail,
  decideIntervention: mockDecideIntervention,
}));

import { interventionsRouter, projectInterventionsRouter } from './router.js';

function makeApp() {
  return new Hono()
    .route('/projects', projectInterventionsRouter)
    .route('/interventions', interventionsRouter);
}

describe('interventions router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists project interventions filtered by status', async () => {
    mockListProjectInterventions.mockResolvedValue({
      ok: true,
      data: { interventions: [{ id: 'i1' }] },
    });

    const res = await makeApp().request('/projects/proj/interventions?status=open');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ interventions: [{ id: 'i1' }] });
    expect(mockListProjectInterventions).toHaveBeenCalledWith('proj', 'open');
  });

  it('lists issue interventions filtered by multiple statuses', async () => {
    mockListIssueInterventions.mockResolvedValue({
      ok: true,
      data: { interventions: [{ id: 'i1', workItemId: 'github:owner/repo#42' }] },
    });

    const res = await makeApp().request(
      '/projects/proj/issues/42/interventions?status=OPEN,PROPOSED',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      interventions: [{ id: 'i1', workItemId: 'github:owner/repo#42' }],
    });
    expect(mockListIssueInterventions).toHaveBeenCalledWith('proj', '42', 'OPEN,PROPOSED');
  });

  it('returns status filter errors', async () => {
    mockListProjectInterventions.mockResolvedValue({
      ok: false,
      error: 'invalid intervention status: WAT',
      status: 400,
    });

    const res = await makeApp().request('/projects/proj/interventions?status=WAT');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid intervention status: WAT' });
  });

  it('returns intervention detail', async () => {
    mockGetInterventionDetail.mockResolvedValue({
      ok: true,
      data: { intervention: { id: 'i1' }, events: [] },
    });

    const res = await makeApp().request('/interventions/i1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ intervention: { id: 'i1' }, events: [] });
  });

  it('decides an intervention', async () => {
    mockDecideIntervention.mockResolvedValue({
      ok: true,
      data: {
        intervention: { id: 'i1', status: 'DECIDED', version: 4 },
        events: [{ id: 1, eventType: 'decide' }],
      },
    });

    const res = await makeApp().request('/interventions/i1/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionType: 'no_action',
        actionPayload: { reason: 'wait' },
        expectedVersion: 3,
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      intervention: { id: 'i1', status: 'DECIDED', version: 4 },
      events: [{ id: 1, eventType: 'decide' }],
    });
    expect(mockDecideIntervention).toHaveBeenCalledWith('i1', {
      actionType: 'no_action',
      actionPayload: { reason: 'wait' },
      expectedVersion: 3,
    });
  });
});
