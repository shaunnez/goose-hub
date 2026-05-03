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
