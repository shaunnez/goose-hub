import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockListPersonas,
  mockGetPersonaRuns,
  mockGetPersonaCandidates,
  mockApproveCandidate,
  mockRejectCandidate,
} = vi.hoisted(() => ({
  mockListPersonas: vi.fn(),
  mockGetPersonaRuns: vi.fn(),
  mockGetPersonaCandidates: vi.fn(),
  mockApproveCandidate: vi.fn(),
  mockRejectCandidate: vi.fn(),
}));

vi.mock('./service.js', () => ({
  listPersonas: mockListPersonas,
  getPersonaRuns: mockGetPersonaRuns,
  getPersonaCandidates: mockGetPersonaCandidates,
  approveCandidate: mockApproveCandidate,
  rejectCandidate: mockRejectCandidate,
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
  it('returns 200 with candidates array', async () => {
    const candidates = [
      {
        id: 1,
        projectId: 'goose-hub-self',
        personaName: 'alice',
        sourceTaskId: 'task-1',
        suggestionText: 'Add retries',
        suggestionType: 'skill-config',
        status: 'pending',
        githubIssueUrl: null,
        errorNote: null,
        proposedDiff: null,
        createdAt: '2026-05-01T00:00:00Z',
      },
    ];
    mockGetPersonaCandidates.mockResolvedValue({ ok: true, data: { candidates } });

    const app = makeApp();
    const res = await app.request('/roster/candidates?persona=alice');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: unknown[] };
    expect(body.candidates).toHaveLength(1);
    expect(mockGetPersonaCandidates).toHaveBeenCalledWith('alice');
  });

  it('returns empty array when service fails', async () => {
    mockGetPersonaCandidates.mockResolvedValue({ ok: false, error: 'db error', status: 500 });

    const app = makeApp();
    const res = await app.request('/roster/candidates?persona=alice');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: unknown[] };
    expect(body.candidates).toEqual([]);
  });
});

describe('POST /roster/candidates/:id/approve', () => {
  it('returns 200 with updated candidate on success', async () => {
    const candidate = {
      id: 1,
      projectId: 'goose-hub-self',
      personaName: 'alice',
      status: 'approved',
      suggestionText: 'Add retries',
      suggestionType: 'skill-config',
      sourceTaskId: null,
      githubIssueUrl: null,
      errorNote: null,
      proposedDiff: null,
      createdAt: '2026-05-01T00:00:00Z',
    };
    mockApproveCandidate.mockResolvedValue({ ok: true, data: { candidate } });

    const app = makeApp();
    const res = await app.request('/roster/candidates/1/approve', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidate: { status: string } };
    expect(body.candidate.status).toBe('approved');
    expect(mockApproveCandidate).toHaveBeenCalledWith(1);
  });

  it('returns 404 when candidate not found', async () => {
    mockApproveCandidate.mockResolvedValue({
      ok: false,
      error: 'candidate not found',
      status: 404,
    });

    const app = makeApp();
    const res = await app.request('/roster/candidates/999/approve', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for non-numeric id', async () => {
    const app = makeApp();
    const res = await app.request('/roster/candidates/abc/approve', { method: 'POST' });
    expect(res.status).toBe(400);
    expect(mockApproveCandidate).not.toHaveBeenCalled();
  });
});

describe('POST /roster/candidates/:id/reject', () => {
  it('returns 200 with updated candidate on success', async () => {
    const candidate = {
      id: 1,
      projectId: 'goose-hub-self',
      personaName: 'alice',
      status: 'rejected',
      suggestionText: 'Add retries',
      suggestionType: 'skill-config',
      sourceTaskId: null,
      githubIssueUrl: null,
      errorNote: null,
      proposedDiff: null,
      createdAt: '2026-05-01T00:00:00Z',
    };
    mockRejectCandidate.mockResolvedValue({ ok: true, data: { candidate } });

    const app = makeApp();
    const res = await app.request('/roster/candidates/1/reject', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidate: { status: string } };
    expect(body.candidate.status).toBe('rejected');
    expect(mockRejectCandidate).toHaveBeenCalledWith(1);
  });

  it('returns 400 for non-numeric id', async () => {
    const app = makeApp();
    const res = await app.request('/roster/candidates/abc/reject', { method: 'POST' });
    expect(res.status).toBe(400);
    expect(mockRejectCandidate).not.toHaveBeenCalled();
  });
});
