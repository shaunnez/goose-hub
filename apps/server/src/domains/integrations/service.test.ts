import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetMilestone,
  mockGetProject,
  mockImportAssignedJiraIssuesToLocalDb,
  mockImportJiraIssueToLocalDb,
} = vi.hoisted(() => ({
  mockGetProject: vi.fn(),
  mockImportAssignedJiraIssuesToLocalDb: vi.fn(),
  mockImportJiraIssueToLocalDb: vi.fn(),
  mockGetMilestone: vi.fn(),
}));

vi.mock('#shared/projects.js', () => ({
  getProject: mockGetProject,
}));

vi.mock('@goose-hub/core/integrations/jira/import-issue.js', () => ({
  importJiraIssueToLocalDb: mockImportJiraIssueToLocalDb,
}));

vi.mock('@goose-hub/core/integrations/jira/import-assigned.js', () => ({
  importAssignedJiraIssuesToLocalDb: mockImportAssignedJiraIssuesToLocalDb,
}));

vi.mock('@goose-hub/core/integrations/jira/rest.js', () => ({
  createJiraRestAdapterFromEnv: vi.fn(() => ({
    getIssue: vi.fn(),
    searchIssues: vi.fn(),
    getCurrentUser: vi.fn(),
  })),
}));

vi.mock('@goose-hub/core/state-source/local-db-repository.js', () => ({
  LocalDbWorkItemRepository: vi.fn(() => ({
    getMilestone: mockGetMilestone,
  })),
}));

import { importAssignedJiraIssues, importJiraIssue } from './service.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMilestone.mockReturnValue({
    number: 7,
    title: 'M7: Atlassian imports',
  });
  mockGetProject.mockResolvedValue({
    id: 'proj',
    slug: 'proj',
    source: {
      kind: 'local-db',
      stateMachine: 'db',
      integrations: {
        jira: {
          enabled: true,
          baseUrl: 'https://company.atlassian.net',
          projectKeys: ['TAS'],
          importMode: 'manual',
        },
      },
    },
    repos: ['owner/repo'],
  });
  mockImportJiraIssueToLocalDb.mockResolvedValue({
    ok: true,
    data: {
      imported: true,
      itemId: 'local:proj#1',
      externalId: '1',
      jiraKey: 'TAS-123',
      jiraUrl: 'https://company.atlassian.net/browse/TAS-123',
      title: 'Manual Jira import',
    },
  });
  mockImportAssignedJiraIssuesToLocalDb.mockResolvedValue({
    ok: true,
    data: {
      counts: { imported: 1, updated: 2, skipped: 0, stale: 1, failed: 1 },
      failures: [{ jiraKey: 'TAS-404', error: 'Jira issue not found' }],
      user: { accountId: 'ada-1', displayName: 'Ada Lovelace' },
    },
  });
});

describe('importJiraIssue', () => {
  it('imports a configured local-db Jira issue and returns a navigation target', async () => {
    const result = await importJiraIssue('proj', { input: 'TAS-123', milestoneNumber: 7 });

    expect(result).toMatchObject({
      ok: true,
      data: {
        item: {
          id: 'local:proj#1',
          externalId: '1',
          jiraKey: 'TAS-123',
          title: 'Manual Jira import',
        },
      },
    });
    expect(mockImportJiraIssueToLocalDb).toHaveBeenCalledWith(
      expect.objectContaining({
        projectConfig: expect.objectContaining({ id: 'proj' }),
        input: 'TAS-123',
        milestone: {
          id: '7',
          title: 'M7: Atlassian imports',
        },
      }),
    );
  });

  it('requires a non-empty input', async () => {
    await expect(importJiraIssue('proj', { input: '   ' })).resolves.toEqual({
      ok: false,
      error: 'input is required',
      status: 400,
    });
    expect(mockImportJiraIssueToLocalDb).not.toHaveBeenCalled();
  });

  it('returns provider errors without creating a server exception', async () => {
    mockImportJiraIssueToLocalDb.mockResolvedValue({
      ok: false,
      error: { kind: 'not_found', message: 'Jira issue not found' },
    });

    await expect(importJiraIssue('proj', { input: 'TAS-404' })).resolves.toEqual({
      ok: false,
      error: 'Jira issue not found',
      status: 404,
    });
  });
});

describe('importAssignedJiraIssues', () => {
  it('runs an assigned-to-me Jira sync and returns counts plus per-issue failures', async () => {
    mockGetProject.mockResolvedValueOnce({
      id: 'proj',
      slug: 'proj',
      source: {
        kind: 'local-db',
        stateMachine: 'db',
        integrations: {
          jira: {
            enabled: true,
            baseUrl: 'https://company.atlassian.net',
            projectKeys: ['TAS'],
            importMode: 'assigned-to-me',
          },
        },
      },
      repos: ['owner/repo'],
    });

    const result = await importAssignedJiraIssues('proj', {
      milestoneNumber: 7,
      maxResults: 100,
      updatedSince: '2026-01-01T00:00:00.000Z',
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        counts: { imported: 1, updated: 2, skipped: 0, stale: 1, failed: 1 },
        failures: [{ jiraKey: 'TAS-404', error: 'Jira issue not found' }],
      },
    });
    expect(mockImportAssignedJiraIssuesToLocalDb).toHaveBeenCalledWith(
      expect.objectContaining({
        projectConfig: expect.objectContaining({ id: 'proj' }),
        milestone: {
          id: '7',
          title: 'M7: Atlassian imports',
        },
        maxResults: 100,
        updatedSince: '2026-01-01T00:00:00.000Z',
      }),
    );
  });

  it('requires assigned-to-me import mode', async () => {
    mockGetProject.mockResolvedValueOnce({
      id: 'proj',
      slug: 'proj',
      source: {
        kind: 'local-db',
        stateMachine: 'db',
        integrations: {
          jira: {
            enabled: true,
            baseUrl: 'https://company.atlassian.net',
            projectKeys: ['TAS'],
            importMode: 'manual',
          },
        },
      },
      repos: ['owner/repo'],
    });

    await expect(importAssignedJiraIssues('proj', {})).resolves.toEqual({
      ok: false,
      error: 'Jira assigned-to-me import is not enabled for this project',
      status: 400,
    });
    expect(mockImportAssignedJiraIssuesToLocalDb).not.toHaveBeenCalled();
  });
});
