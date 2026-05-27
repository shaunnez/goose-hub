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
});
