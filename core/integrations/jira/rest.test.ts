import { describe, expect, it, vi } from 'vitest';
import { getArtifact } from '../../agent-artifacts/repository.js';
import { createJiraRestAdapter } from './rest.js';

function response(status: number, body: unknown, statusText = 'OK') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers(),
    json: async () => body,
  } as Response;
}

describe('Jira REST adapter', () => {
  it('maps a Jira REST issue response into a validated detail DTO with artifact refs', async () => {
    const fetchImpl = vi.fn(async () =>
      response(200, {
        id: '10001',
        key: 'TAS-123',
        fields: {
          summary: 'Manual Jira import',
          description: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Long Jira description '.repeat(20) }],
              },
            ],
          },
          status: { name: 'To Do' },
          issuetype: { name: 'Story' },
          priority: { name: 'High' },
          assignee: { displayName: 'Ada Lovelace', accountId: 'ada-1' },
          labels: ['factory'],
          components: [{ name: 'hub' }],
          created: '2026-05-26T00:00:00.000Z',
          updated: '2026-05-27T00:00:00.000Z',
        },
      }),
    );
    const adapter = createJiraRestAdapter({
      baseUrl: 'https://company.atlassian.net',
      email: 'ada@example.com',
      apiToken: 'secret-token',
      fetchImpl,
      artifactContext: {
        projectId: 'jira-rest-test',
        runId: 'jira-rest-run',
        thresholdBytes: 10,
      },
    });

    const result = await adapter.getIssue({ key: 'TAS-123', tier: 'detail' });

    expect(result).toMatchObject({
      ok: true,
      data: {
        provider: 'jira',
        resourceKind: 'issue',
        tier: 'detail',
        key: 'TAS-123',
        title: 'Manual Jira import',
        status: 'To Do',
        bodyArtifactRef: { stored: true },
        rawArtifactRef: { stored: true },
      },
    });
    if (result.ok) {
      expect(result.data).not.toHaveProperty('fields');
      expect(getArtifact(result.data.rawArtifactRef?.artifactKey ?? '')?.payload).toMatchObject({
        key: 'TAS-123',
      });
    }
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://company.atlassian.net/rest/api/3/issue/TAS-123',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
        }),
      }),
    );
  });

  it('maps provider HTTP errors into typed failures', async () => {
    const adapter = createJiraRestAdapter({
      baseUrl: 'https://company.atlassian.net',
      email: 'ada@example.com',
      apiToken: 'secret-token',
      fetchImpl: vi.fn(async () =>
        response(401, { errorMessages: ['Unauthorized'] }, 'Unauthorized'),
      ),
    });

    await expect(adapter.getIssue({ key: 'TAS-123', tier: 'detail' })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'auth', status: 401 },
    });
  });

  it('resolves the current Jira user from the myself endpoint', async () => {
    const fetchImpl = vi.fn(async () =>
      response(200, {
        accountId: 'ada-1',
        displayName: 'Ada Lovelace',
      }),
    );
    const adapter = createJiraRestAdapter({
      baseUrl: 'https://company.atlassian.net',
      email: 'ada@example.com',
      apiToken: 'secret-token',
      fetchImpl,
    });

    await expect(adapter.getCurrentUser()).resolves.toEqual({
      ok: true,
      data: { accountId: 'ada-1', displayName: 'Ada Lovelace' },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://company.atlassian.net/rest/api/3/myself',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
        }),
      }),
    );
  });

  it('searches assigned Jira issues with internally built JQL and maps card DTOs', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      response(200, {
        issues: [
          {
            id: '10001',
            key: 'TAS-123',
            fields: {
              summary: 'Assigned issue',
              status: { name: 'In Progress' },
              issuetype: { name: 'Task' },
              priority: { name: 'Medium' },
              assignee: { displayName: 'Ada Lovelace', accountId: 'ada-1' },
              created: '2026-05-26T00:00:00.000Z',
              updated: '2026-05-27T00:00:00.000Z',
            },
          },
        ],
        total: 1,
        isLast: true,
      }),
    );
    const adapter = createJiraRestAdapter({
      baseUrl: 'https://company.atlassian.net',
      email: 'ada@example.com',
      apiToken: 'secret-token',
      fetchImpl,
    });

    await expect(
      adapter.searchIssues({
        level: 'L2',
        projects: ['TAS', 'OPS'],
        maxResults: 25,
        updated: {
          from: '2026-04-27T00:00:00.000Z',
          to: '2026-05-27T00:00:00.000Z',
        },
        assignee: { accountId: 'ada-1' },
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        provider: 'jira',
        tier: 'card',
        issues: [{ key: 'TAS-123', title: 'Assigned issue' }],
        totalCount: 1,
        hasMore: false,
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/rest/api/3/search/jql?'),
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/json' }),
      }),
    );
    const firstCall = fetchImpl.mock.calls[0];
    if (firstCall == null) throw new Error('expected Jira search fetch call');
    const url = new URL(String(firstCall[0]));
    expect(url.searchParams.get('maxResults')).toBe('25');
    expect(url.searchParams.get('fields')).toContain('summary');
    expect(url.searchParams.get('jql')).toBe(
      'project in ("TAS","OPS") AND assignee = "ada-1" AND updated >= "2026-04-27T00:00:00.000Z" AND updated <= "2026-05-27T00:00:00.000Z" ORDER BY updated DESC',
    );
  });
});
