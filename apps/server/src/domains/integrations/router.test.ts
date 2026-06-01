import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockImportAssignedJiraIssues, mockImportJiraIssue } = vi.hoisted(() => ({
  mockImportAssignedJiraIssues: vi.fn(),
  mockImportJiraIssue: vi.fn(),
}));

vi.mock('./service.js', () => ({
  importAssignedJiraIssues: mockImportAssignedJiraIssues,
  importJiraIssue: mockImportJiraIssue,
}));

import { integrationsRouter } from './router.js';

function makeApp() {
  return new Hono().route('/projects', integrationsRouter);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /projects/:slug/integrations/jira/import-assigned-to-me', () => {
  it('returns assigned sync result counts from the service', async () => {
    mockImportAssignedJiraIssues.mockResolvedValue({
      ok: true,
      data: {
        counts: { imported: 1, updated: 2, skipped: 0, stale: 1, failed: 1 },
        failures: [{ jiraKey: 'TAS-404', error: 'Jira issue not found' }],
      },
    });

    const res = await makeApp().request('/projects/proj/integrations/jira/import-assigned-to-me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxResults: 25 }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      counts: { imported: 1, updated: 2, stale: 1, failed: 1 },
      failures: [{ jiraKey: 'TAS-404' }],
    });
    expect(mockImportAssignedJiraIssues).toHaveBeenCalledWith('proj', { maxResults: 25 });
  });
});

describe('POST /projects/:slug/integrations/jira/import', () => {
  it('returns the imported item DTO from the service', async () => {
    mockImportJiraIssue.mockResolvedValue({
      ok: true,
      data: {
        item: {
          id: 'local:proj#1',
          externalId: '1',
          jiraKey: 'TAS-123',
          jiraUrl: 'https://company.atlassian.net/browse/TAS-123',
          title: 'Manual Jira import',
          imported: true,
        },
      },
    });

    const res = await makeApp().request('/projects/proj/integrations/jira/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'TAS-123' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ item: { externalId: '1', jiraKey: 'TAS-123' } });
    expect(mockImportJiraIssue).toHaveBeenCalledWith('proj', { input: 'TAS-123' });
  });

  it('returns the service error status', async () => {
    mockImportJiraIssue.mockResolvedValue({
      ok: false,
      error: 'Jira issue not found',
      status: 404,
    });

    const res = await makeApp().request('/projects/proj/integrations/jira/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'TAS-404' }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Jira issue not found' });
  });
});
