import { describe, expect, it, vi } from 'vitest';

const mockPersonas = [
  {
    id: 1,
    personaName: 'alice',
    role: 'developer',
    runsTotal: 5,
    runsSucceeded: 4,
    runsFailed: 1,
    avgQualityScore: 0.85,
    lastRunAt: '2026-05-01T00:00:00Z',
  },
  {
    id: 2,
    personaName: 'bob',
    role: 'qa',
    runsTotal: 3,
    runsSucceeded: 3,
    runsFailed: 0,
    avgQualityScore: 1.0,
    lastRunAt: '2026-05-02T00:00:00Z',
  },
];

describe('roster — fetchRoster', () => {
  it('resolves to a PersonaStatDto array', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockPersonas);
    vi.doMock('@/lib/api', () => ({
      fetchRoster: mockFetch,
      fetchPersonaRuns: vi.fn(),
      fetchPersonaCandidates: vi.fn(),
    }));
    const { fetchRoster } = await import('@/lib/api');
    vi.mocked(fetchRoster).mockResolvedValue(mockPersonas);
    const personas = await fetchRoster();
    expect(personas).toHaveLength(2);
    expect(personas[0].personaName).toBe('alice');
    expect(personas[1].role).toBe('qa');
  });

  it('returns empty array when no personas exist', async () => {
    const { fetchRoster } = await import('@/lib/api');
    vi.mocked(fetchRoster).mockResolvedValue([]);
    const personas = await fetchRoster();
    expect(personas).toEqual([]);
  });
});

describe('roster — fetchPersonaRuns', () => {
  it('resolves to an empty array when no run history exists', async () => {
    const { fetchPersonaRuns } = await import('@/lib/api');
    vi.mocked(fetchPersonaRuns).mockResolvedValue([]);
    const runs = await fetchPersonaRuns('alice');
    expect(runs).toEqual([]);
  });
});

describe('roster — fetchPersonaCandidates', () => {
  it('resolves to an empty array when no candidates exist', async () => {
    const { fetchPersonaCandidates } = await import('@/lib/api');
    vi.mocked(fetchPersonaCandidates).mockResolvedValue([]);
    const candidates = await fetchPersonaCandidates('alice');
    expect(candidates).toEqual([]);
  });

  it('resolves to a candidate array when candidates exist', async () => {
    const { fetchPersonaCandidates } = await import('@/lib/api');
    const mockCandidates = [
      {
        id: 1,
        personaName: 'goose-hub-self/retrospector/0',
        sourceTaskId: 'task-1',
        suggestionText: 'Improve error handling',
        suggestionType: 'skill-prompt',
        status: 'pending',
        createdAt: '2026-05-01T00:00:00Z',
      },
    ];
    vi.mocked(fetchPersonaCandidates).mockResolvedValue(mockCandidates);
    const candidates = await fetchPersonaCandidates('goose-hub-self/retrospector/0');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].status).toBe('pending');
    expect(candidates[0].suggestionType).toBe('skill-prompt');
  });
});

describe('roster — approveCandidateById', () => {
  it('resolves to the updated candidate with approved status', async () => {
    const mockApprove = vi.fn().mockResolvedValue({
      id: 1,
      personaName: 'alice',
      sourceTaskId: null,
      suggestionText: 'Add retries',
      suggestionType: 'skill-config',
      status: 'approved',
      createdAt: '2026-05-01T00:00:00Z',
    });
    vi.doMock('@/lib/api', () => ({
      approveCandidateById: mockApprove,
      rejectCandidateById: vi.fn(),
      fetchRoster: vi.fn(),
      fetchPersonaRuns: vi.fn(),
      fetchPersonaCandidates: vi.fn(),
    }));
    const { approveCandidateById } = await import('@/lib/api');
    vi.mocked(approveCandidateById).mockResolvedValue({
      id: 1,
      personaName: 'alice',
      sourceTaskId: null,
      suggestionText: 'Add retries',
      suggestionType: 'skill-config',
      status: 'approved',
      createdAt: '2026-05-01T00:00:00Z',
    });
    const result = await approveCandidateById(1);
    expect(result.status).toBe('approved');
  });
});

describe('roster — rejectCandidateById', () => {
  it('resolves to the updated candidate with rejected status', async () => {
    const mockReject = vi.fn().mockResolvedValue({
      id: 1,
      personaName: 'alice',
      sourceTaskId: null,
      suggestionText: 'Add retries',
      suggestionType: 'skill-config',
      status: 'rejected',
      createdAt: '2026-05-01T00:00:00Z',
    });
    vi.doMock('@/lib/api', () => ({
      approveCandidateById: vi.fn(),
      rejectCandidateById: mockReject,
      fetchRoster: vi.fn(),
      fetchPersonaRuns: vi.fn(),
      fetchPersonaCandidates: vi.fn(),
    }));
    const result = await mockReject(1);
    expect(result.status).toBe('rejected');
    expect(mockReject).toHaveBeenCalledWith(1);
  });
});

describe('roster — grouping by role', () => {
  it('groups personas into distinct roles', () => {
    const grouped: Record<string, typeof mockPersonas> = {};
    for (const p of mockPersonas) {
      if (!grouped[p.role]) grouped[p.role] = [];
      grouped[p.role].push(p);
    }
    expect(Object.keys(grouped)).toContain('developer');
    expect(Object.keys(grouped)).toContain('qa');
    expect(grouped.developer).toHaveLength(1);
    expect(grouped.developer[0].personaName).toBe('alice');
  });
});
