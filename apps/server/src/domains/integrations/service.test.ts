import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetMilestone, mockGetProject, mockImportJiraIssueToLocalDb } = vi.hoisted(() => ({
  mockGetProject: vi.fn(),
  mockImportJiraIssueToLocalDb: vi.fn(),
  mockGetMilestone: vi.fn(),
}));

vi.mock('#shared/projects.js', () => ({
  getProject: mockGetProject,
}));

vi.mock('@goose-hub/core/integrations/jira/import-issue.js', () => ({
  importJiraIssueToLocalDb: mockImportJiraIssueToLocalDb,
}));

vi.mock('@goose-hub/core/integrations/jira/rest.js', () => ({
  createJiraRestAdapterFromEnv: vi.fn(() => ({ getIssue: vi.fn() })),
}));

vi.mock('@goose-hub/core/state-source/local-db-repository.js', () => ({
  LocalDbWorkItemRepository: vi.fn(() => ({
    getMilestone: mockGetMilestone,
  })),
}));

import { importJiraIssue } from './service.js';

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
