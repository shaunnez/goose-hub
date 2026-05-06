import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSelect, mockInsert, mockUpdate } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('@goose-hub/core/db/db.js', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  },
}));

vi.mock('@goose-hub/core/db/schema.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@goose-hub/core/db/schema.js')>();
  return { ...actual };
});

const {
  listPersonaNames,
  listPersonaStats,
  listCandidatesByPersona,
  getCandidateById,
  updateCandidateStatus,
  updateCandidateGithubIssue,
  insertCandidate,
} = await import('./repository.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listPersonaNames', () => {
  it('flattens projectId/role/slotIndex into a personaId', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockResolvedValue([
        { projectId: 'goose-hub-self', role: 'developer', slotIndex: 0, codename: 'alice' },
        { projectId: 'goose-hub-self', role: 'qa', slotIndex: 1, codename: 'bob' },
      ]),
    });

    const result = await listPersonaNames();
    expect(result).toEqual([
      { personaId: 'goose-hub-self/developer/0', codename: 'alice', role: 'developer' },
      { personaId: 'goose-hub-self/qa/1', codename: 'bob', role: 'qa' },
    ]);
  });
});

describe('listPersonaStats', () => {
  it('joins persona stats with codenames using personaName as the key', async () => {
    const statRow = {
      id: 1,
      personaName: 'goose-hub-self/developer/0',
      role: 'developer',
      runsTotal: 5,
      runsSucceeded: 4,
      runsFailed: 1,
      avgQualityScore: 0.85,
      lastRunAt: '2026-05-01T00:00:00Z',
    };
    const nameRow = {
      projectId: 'goose-hub-self',
      role: 'developer',
      slotIndex: 0,
      codename: 'alice',
    };

    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([statRow]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockResolvedValue([nameRow]),
      });

    const result = await listPersonaStats();
    expect(result).toHaveLength(1);
    expect(result[0].codename).toBe('alice');
    expect(result[0].runsTotal).toBe(5);
  });

  it('returns codename: null when no matching persona-name row exists', async () => {
    const statRow = {
      id: 2,
      personaName: 'orphan/role/0',
      role: 'role',
      runsTotal: 0,
      runsSucceeded: 0,
      runsFailed: 0,
      avgQualityScore: 0,
      lastRunAt: '2026-05-01T00:00:00Z',
    };

    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([statRow]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockResolvedValue([]),
      });

    const result = await listPersonaStats();
    expect(result[0].codename).toBeNull();
  });
});

describe('listCandidatesByPersona', () => {
  it('filters by personaName and the supplied status', async () => {
    const orderBy = vi.fn().mockResolvedValue([{ id: 1, status: 'pending' }]);
    const where = vi.fn().mockReturnValue({ orderBy });
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({ where }),
    });

    const result = await listCandidatesByPersona('alice', 'pending');
    expect(result).toEqual([{ id: 1, status: 'pending' }]);
    expect(where).toHaveBeenCalled();
  });

  it('defaults the status filter to "pending"', async () => {
    const orderBy = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ orderBy });
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({ where }),
    });

    await listCandidatesByPersona('alice');
    expect(where).toHaveBeenCalled();
  });
});

describe('getCandidateById', () => {
  it('returns the row when found', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 1, suggestionText: 'Add retries' }]),
      }),
    });

    const result = await getCandidateById(1);
    expect(result).toEqual({ id: 1, suggestionText: 'Add retries' });
  });

  it('returns null when no row is found', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    expect(await getCandidateById(999)).toBeNull();
  });
});

describe('updateCandidateStatus', () => {
  it('updates the row and returns the updated record', async () => {
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 1, status: 'approved' }]),
      }),
    });

    const result = await updateCandidateStatus(1, 'approved');
    expect(result).toEqual({ id: 1, status: 'approved' });
  });

  it('returns null when the post-update read finds no row', async () => {
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    expect(await updateCandidateStatus(404, 'rejected')).toBeNull();
  });
});

describe('updateCandidateGithubIssue', () => {
  it('writes the issue url + error note and returns the updated row', async () => {
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi
          .fn()
          .mockResolvedValue([{ id: 5, githubIssueUrl: 'https://gh/i/9', errorNote: null }]),
      }),
    });

    const result = await updateCandidateGithubIssue(5, 'https://gh/i/9', null);
    expect(result?.githubIssueUrl).toBe('https://gh/i/9');
  });

  it('returns null when the row no longer exists', async () => {
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    expect(await updateCandidateGithubIssue(999, null, 'some-error')).toBeNull();
  });
});

describe('insertCandidate', () => {
  it('inserts the row and returns it', async () => {
    const inserted = {
      id: 7,
      projectId: 'goose-hub-self',
      personaName: 'alice',
      sourceTaskId: null,
      suggestionText: 'Add retries',
      suggestionType: 'skill-config',
    };
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([inserted]),
      }),
    });

    const result = await insertCandidate({
      projectId: 'goose-hub-self',
      personaName: 'alice',
      sourceTaskId: null,
      suggestionText: 'Add retries',
      suggestionType: 'skill-config',
    });
    expect(result).toEqual(inserted);
  });
});
