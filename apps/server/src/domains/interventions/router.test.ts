import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListProjectInterventions, mockGetInterventionDetail, mockDecideIntervention } =
  vi.hoisted(() => ({
    mockListProjectInterventions: vi.fn(),
    mockGetInterventionDetail: vi.fn(),
    mockDecideIntervention: vi.fn(),
  }));

vi.mock('./service.js', () => ({
  listProjectInterventions: mockListProjectInterventions,
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
      data: { intervention: { id: 'i1', status: 'DECIDED' } },
    });

    const res = await makeApp().request('/interventions/i1/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionType: 'no_action',
        actionPayload: { reason: 'wait' },
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ intervention: { id: 'i1', status: 'DECIDED' } });
    expect(mockDecideIntervention).toHaveBeenCalledWith('i1', {
      actionType: 'no_action',
      actionPayload: { reason: 'wait' },
    });
  });
});
