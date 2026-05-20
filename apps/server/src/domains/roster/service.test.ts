import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const mockCandidateRow = {
  id: 1,
  projectId: 'goose-hub-self',
  personaName: 'goose-hub-self/retrospector/0',
  sourceTaskId: 'github:owner/repo#42',
  suggestionText: 'Add error handling to the implement skill',
  suggestionType: 'skill-prompt',
  status: 'pending',
  githubIssueUrl: null,
  errorNote: null,
  proposedDiff: null,
  createdAt: '2026-05-01T00:00:00Z',
};

const {
  mockListPersonaStats,
  mockListCandidatesByPersona,
  mockUpdateCandidateStatus,
  mockGetCandidateById,
  mockUpdateCandidateGithubIssue,
  mockListRunsByPersona,
  mockResolveActiveMilestone,
} = vi.hoisted(() => ({
  mockListPersonaStats: vi.fn(),
  mockListCandidatesByPersona: vi.fn(),
  mockUpdateCandidateStatus: vi.fn(),
  mockGetCandidateById: vi.fn(),
  mockUpdateCandidateGithubIssue: vi.fn(),
  mockListRunsByPersona: vi.fn().mockReturnValue([]),
  mockResolveActiveMilestone: vi.fn(),
}));

vi.mock('./repository.js', () => ({
  listPersonaStats: mockListPersonaStats,
  listCandidatesByPersona: mockListCandidatesByPersona,
  updateCandidateStatus: mockUpdateCandidateStatus,
  getCandidateById: mockGetCandidateById,
  updateCandidateGithubIssue: mockUpdateCandidateGithubIssue,
  listRunsByPersona: mockListRunsByPersona,
}));

const { mockGetProject } = vi.hoisted(() => ({
  mockGetProject: vi.fn(),
}));

vi.mock('../../shared/projects.js', () => ({
  getProject: mockGetProject,
  listProjects: vi.fn(),
}));

vi.mock('#shared/resolve-milestone.js', () => ({
  resolveActiveMilestone: mockResolveActiveMilestone,
}));

import {
  approveCandidate,
  getPersonaCandidates,
  getPersonaRuns,
  listPersonas,
  rejectCandidate,
} from './service.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockResolveActiveMilestone.mockResolvedValue({ milestoneNumber: 22, source: 'config' });
});

afterEach(() => {
  vi.unstubAllGlobals();
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
  it('returns empty array when no runs exist', async () => {
    mockListRunsByPersona.mockReturnValue([]);
    const result = await getPersonaRuns('alice');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.runs).toEqual([]);
    }
    expect(mockListRunsByPersona).toHaveBeenCalledWith('alice');
  });

  it('maps AgentRunRow to PersonaRunDto with qualityScore: null', async () => {
    mockListRunsByPersona.mockReturnValue([
      {
        id: 1,
        runId: 'run-xyz',
        personaId: 'proj/developer/0',
        workItemId: 'github:owner/repo#5',
        projectId: 'proj',
        role: 'developer',
        skill: 'fix-issue',
        outcome: 'success',
        createdAt: '2026-05-10T10:00:00Z',
      },
    ]);
    const result = await getPersonaRuns('proj/developer/0');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.runs).toHaveLength(1);
      const run = result.data.runs[0];
      expect(run.runId).toBe('run-xyz');
      expect(run.workItemId).toBe('github:owner/repo#5');
      expect(run.outcome).toBe('success');
      expect(run.qualityScore).toBeNull();
      expect(run.createdAt).toBe('2026-05-10T10:00:00Z');
    }
  });
});

describe('getPersonaCandidates', () => {
  it('returns pending candidates for a persona from the DB', async () => {
    mockListCandidatesByPersona.mockResolvedValue([mockCandidateRow]);
    const result = await getPersonaCandidates('goose-hub-self/retrospector/0');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.candidates).toHaveLength(1);
      expect(result.data.candidates[0].suggestionType).toBe('skill-prompt');
      expect(result.data.candidates[0].status).toBe('pending');
    }
    expect(mockListCandidatesByPersona).toHaveBeenCalledWith(
      'goose-hub-self/retrospector/0',
      'pending',
    );
  });

  it('returns empty array when no candidates exist', async () => {
    mockListCandidatesByPersona.mockResolvedValue([]);
    const result = await getPersonaCandidates('alice');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.candidates).toEqual([]);
    }
  });
});

describe('approveCandidate', () => {
  it('returns 404 when candidate not found', async () => {
    mockGetCandidateById.mockResolvedValue(null);
    const result = await approveCandidate(999);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });

  it('creates GitHub issue and stores url on success', async () => {
    const approved = { ...mockCandidateRow, status: 'approved' };
    const withUrl = { ...approved, githubIssueUrl: 'https://github.com/owner/repo/issues/99' };
    mockGetCandidateById.mockResolvedValue(mockCandidateRow);
    mockUpdateCandidateStatus.mockResolvedValue(approved);
    mockGetProject.mockResolvedValue({
      id: 'goose-hub-self',
      source: { kind: 'github', repo: 'owner/repo' },
    });
    mockUpdateCandidateGithubIssue.mockResolvedValue(withUrl);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: 'https://github.com/owner/repo/issues/99', number: 99 }),
      }),
    );
    vi.stubEnv('GITHUB_TOKEN', 'test-token');

    const result = await approveCandidate(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.candidate.status).toBe('approved');
      expect(result.data.candidate.githubIssueUrl).toBe('https://github.com/owner/repo/issues/99');
    }
    expect(mockUpdateCandidateGithubIssue).toHaveBeenCalledWith(
      1,
      'https://github.com/owner/repo/issues/99',
      null,
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/issues',
      expect.objectContaining({
        body: expect.stringContaining('"milestone":22'),
      }),
    );
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string) as {
      labels: string[];
    };
    expect(body.labels).toContain('schedule:later');
  });

  it('omits milestone when the project has no active milestone', async () => {
    const approved = { ...mockCandidateRow, status: 'approved' };
    const withUrl = { ...approved, githubIssueUrl: 'https://github.com/owner/repo/issues/99' };
    mockGetCandidateById.mockResolvedValue(mockCandidateRow);
    mockUpdateCandidateStatus.mockResolvedValue(approved);
    mockGetProject.mockResolvedValue({
      id: 'goose-hub-self',
      source: { kind: 'github', repo: 'owner/repo' },
    });
    mockResolveActiveMilestone.mockResolvedValue({
      milestoneNumber: null,
      source: 'project_state',
    });
    mockUpdateCandidateGithubIssue.mockResolvedValue(withUrl);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: 'https://github.com/owner/repo/issues/99', number: 99 }),
      }),
    );
    vi.stubEnv('GITHUB_TOKEN', 'test-token');

    const result = await approveCandidate(1);
    expect(result.ok).toBe(true);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string) as {
      milestone?: number;
      labels: string[];
    };
    expect(body.milestone).toBeUndefined();
    expect(body.labels).toContain('schedule:later');
  });

  it('stores error note when GitHub API call fails', async () => {
    const approved = { ...mockCandidateRow, status: 'approved' };
    const withError = { ...approved, errorNote: 'GitHub API error: 422 Unprocessable Entity' };
    mockGetCandidateById.mockResolvedValue(mockCandidateRow);
    mockUpdateCandidateStatus.mockResolvedValue(approved);
    mockGetProject.mockResolvedValue({
      id: 'goose-hub-self',
      source: { kind: 'github', repo: 'owner/repo' },
    });
    mockUpdateCandidateGithubIssue.mockResolvedValue(withError);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
      }),
    );
    vi.stubEnv('GITHUB_TOKEN', 'test-token');

    const result = await approveCandidate(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.candidate.status).toBe('approved');
      expect(result.data.candidate.errorNote).toBeTruthy();
    }
    expect(mockUpdateCandidateGithubIssue).toHaveBeenCalledWith(
      1,
      null,
      expect.stringContaining('422'),
    );
  });

  it('stores error note when project config is not found', async () => {
    const approved = { ...mockCandidateRow, status: 'approved' };
    const withError = {
      ...approved,
      errorNote: 'Could not resolve project config or GitHub token',
    };
    mockGetCandidateById.mockResolvedValue(mockCandidateRow);
    mockUpdateCandidateStatus.mockResolvedValue(approved);
    mockGetProject.mockResolvedValue(null);
    mockUpdateCandidateGithubIssue.mockResolvedValue(withError);

    vi.stubEnv('GITHUB_TOKEN', 'test-token');

    const result = await approveCandidate(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.candidate.errorNote).toBeTruthy();
    }
  });
});

describe('rejectCandidate', () => {
  it('returns updated candidate with rejected status', async () => {
    const rejected = { ...mockCandidateRow, status: 'rejected' };
    mockUpdateCandidateStatus.mockResolvedValue(rejected);
    const result = await rejectCandidate(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.candidate.status).toBe('rejected');
    }
    expect(mockUpdateCandidateStatus).toHaveBeenCalledWith(1, 'rejected');
  });

  it('returns 404 when candidate not found', async () => {
    mockUpdateCandidateStatus.mockResolvedValue(null);
    const result = await rejectCandidate(999);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });
});
