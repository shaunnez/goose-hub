import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListPersonas, mockGetPersonaRuns, mockGetPersonaCandidates } = vi.hoisted(() => ({
  mockListPersonas: vi.fn(),
  mockGetPersonaRuns: vi.fn(),
  mockGetPersonaCandidates: vi.fn(),
}));

vi.mock('./service.js', () => ({
  listPersonas: mockListPersonas,
  getPersonaRuns: mockGetPersonaRuns,
  getPersonaCandidates: mockGetPersonaCandidates,
}));

import { rosterRouter } from './router.js';

function makeApp() {
  return new Hono().route('/roster', rosterRouter);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /roster', () => {
  it('returns 200 with personas array', async () => {
    const personas = [
      {
        id: 1,
        personaName: 'alice',
        role: 'developer',
        runsTotal: 3,
        runsSucceeded: 3,
        runsFailed: 0,
        avgQualityScore: 1.0,
        lastRunAt: '2026-05-01T00:00:00Z',
      },
    ];
    mockListPersonas.mockResolvedValue({ ok: true, data: { personas } });

    const app = makeApp();
    const res = await app.request('/roster');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { personas: unknown[] };
    expect(body.personas).toHaveLength(1);
  });

  it('returns empty personas array when service fails', async () => {
    mockListPersonas.mockResolvedValue({ ok: false, error: 'db error', status: 500 });

    const app = makeApp();
    const res = await app.request('/roster');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { personas: unknown[] };
    expect(body.personas).toEqual([]);
  });
});

describe('GET /roster/runs', () => {
  it('returns 200 with empty runs array', async () => {
    mockGetPersonaRuns.mockResolvedValue({ ok: true, data: { runs: [] } });

    const app = makeApp();
    const res = await app.request('/roster/runs?persona=alice');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: unknown[] };
    expect(body.runs).toEqual([]);
    expect(mockGetPersonaRuns).toHaveBeenCalledWith('alice');
  });

  it('passes empty string when persona query param is absent', async () => {
    mockGetPersonaRuns.mockResolvedValue({ ok: true, data: { runs: [] } });

    const app = makeApp();
    await app.request('/roster/runs');
    expect(mockGetPersonaRuns).toHaveBeenCalledWith('');
  });
});

describe('GET /roster/candidates', () => {
  it('returns 200 with empty candidates array', async () => {
    mockGetPersonaCandidates.mockResolvedValue({ ok: true, data: { candidates: [] } });

    const app = makeApp();
    const res = await app.request('/roster/candidates?persona=alice');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: unknown[] };
    expect(body.candidates).toEqual([]);
    expect(mockGetPersonaCandidates).toHaveBeenCalledWith('alice');
  });
});
