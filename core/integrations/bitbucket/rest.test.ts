import { describe, expect, it, vi } from 'vitest';
import { createBitbucketRestAdapter } from './rest.js';

function response(status: number, body: unknown, statusText = 'OK') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers(),
    json: async () => body,
    text: async () => String(body),
  } as Response;
}

describe('Bitbucket REST adapter', () => {
  it('maps pull request metadata into a validated detail DTO', async () => {
    const fetchImpl = vi.fn(async () =>
      response(200, {
        id: 45,
        title: 'Ship provider-specific PR diffs',
        state: 'OPEN',
        description: 'Use the Bitbucket diff endpoint.',
        created_on: '2026-05-26T00:00:00.000Z',
        updated_on: '2026-05-27T00:00:00.000Z',
        links: {
          html: {
            href: 'https://bitbucket.org/workspace/repo/pull-requests/45',
          },
        },
        destination: {
          repository: {
            full_name: 'workspace/repo',
          },
        },
      }),
    );
    const adapter = createBitbucketRestAdapter({
      username: 'ada',
      appPassword: 'secret-token',
      fetchImpl,
    });

    await expect(
      adapter.getPullRequest({
        workspace: 'workspace',
        repo: 'repo',
        pullRequestId: '45',
        tier: 'detail',
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        provider: 'bitbucket',
        resourceKind: 'pull_request',
        tier: 'detail',
        id: '45',
        title: 'Ship provider-specific PR diffs',
        status: 'OPEN',
        repoRef: 'workspace/repo',
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.bitbucket.org/2.0/repositories/workspace/repo/pullrequests/45',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: expect.stringMatching(/^Basic /),
        }),
      }),
    );
  });

  it('returns typed pull request diffs from the diff endpoint', async () => {
    const fetchImpl = vi.fn(async () => response(200, 'diff --git a/a.ts b/a.ts'));
    const adapter = createBitbucketRestAdapter({
      accessToken: 'access-token',
      fetchImpl,
    });

    await expect(
      adapter.getPullRequestDiff({
        workspace: 'workspace',
        repo: 'repo',
        pullRequestId: '45',
      }),
    ).resolves.toEqual({
      ok: true,
      data: {
        provider: 'bitbucket',
        resourceKind: 'pull_request',
        repoRef: 'workspace/repo',
        externalId: '45',
        diff: 'diff --git a/a.ts b/a.ts',
        url: 'https://bitbucket.org/workspace/repo/pull-requests/45',
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.bitbucket.org/2.0/repositories/workspace/repo/pullrequests/45/diff',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'text/plain',
          Authorization: 'Bearer access-token',
        }),
      }),
    );
  });

  it('maps provider HTTP errors into typed failures', async () => {
    const adapter = createBitbucketRestAdapter({
      accessToken: 'access-token',
      fetchImpl: vi.fn(async () => response(404, { error: { message: 'Not found' } }, 'Not Found')),
    });

    await expect(
      adapter.getPullRequestDiff({
        workspace: 'workspace',
        repo: 'repo',
        pullRequestId: '45',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'not_found', status: 404 },
    });
  });
});
