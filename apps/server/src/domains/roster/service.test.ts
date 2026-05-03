import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockStats = [
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

const { mockListPersonaStats } = vi.hoisted(() => ({
  mockListPersonaStats: vi.fn(),
}));

vi.mock('./repository.js', () => ({
  listPersonaStats: mockListPersonaStats,
}));

import { getPersonaCandidates, getPersonaRuns, listPersonas } from './service.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listPersonas', () => {
  it('returns all persona stats from the DB', async () => {
    mockListPersonaStats.mockResolvedValue(mockStats);
    const result = await listPersonas();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.personas).toHaveLength(2);
      expect(result.data.personas[0].personaName).toBe('alice');
      expect(result.data.personas[1].role).toBe('qa');
    }
  });

  it('returns empty array when no personas exist', async () => {
    mockListPersonaStats.mockResolvedValue([]);
    const result = await listPersonas();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.personas).toHaveLength(0);
    }
  });
});

describe('getPersonaRuns', () => {
  it('returns empty run history (no per-run table yet)', async () => {
    const result = await getPersonaRuns('alice');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.runs).toEqual([]);
    }
  });

  it('accepts any persona name without error', async () => {
    const result = await getPersonaRuns('unknown-persona');
    expect(result.ok).toBe(true);
  });
});

describe('getPersonaCandidates', () => {
  it('returns empty candidates list (table created in #264)', async () => {
    const result = await getPersonaCandidates('alice');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.candidates).toEqual([]);
    }
  });

  it('accepts any persona name without error', async () => {
    const result = await getPersonaCandidates('unknown-persona');
    expect(result.ok).toBe(true);
  });
});
