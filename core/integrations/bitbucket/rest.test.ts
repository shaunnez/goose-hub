import { describe, expect, it, vi } from 'vitest';
import { createBitbucketPullRequest, createBitbucketRestAdapter } from './rest.js';

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

describe('createBitbucketPullRequest', () => {
  it('posts correct payload and maps id/url from response', async () => {
    const fetchImpl = vi.fn(async () =>
      response(201, {
        id: 77,
        title: 'Factory: add capitalize helper',
        links: { html: { href: 'https://bitbucket.org/ws/repo/pull-requests/77' } },
      }),
    );

    const result = await createBitbucketPullRequest({
      workspace: 'ws',
      repo: 'repo',
      title: 'Factory: add capitalize helper',
      description: 'Closes #42',
      sourceBranch: 'factory/run-1',
      targetBranch: 'main',
      username: 'ada',
      appPassword: 'secret',
      fetchImpl,
    });

    expect(result).toEqual({
      prNumber: 77,
      prUrl: 'https://bitbucket.org/ws/repo/pull-requests/77',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      title: 'Factory: add capitalize helper',
      description: 'Closes #42',
      source: { branch: { name: 'factory/run-1' } },
      destination: { branch: { name: 'main' } },
    });
  });

  it('falls back to constructed URL when response omits links', async () => {
    const fetchImpl = vi.fn(async () => response(201, { id: 12 }));

    const result = await createBitbucketPullRequest({
      workspace: 'ws',
      repo: 'repo',
      title: 'T',
      sourceBranch: 'factory/x',
      targetBranch: 'main',
      username: 'ada',
      appPassword: 'secret',
      fetchImpl,
    });

    expect(result.prUrl).toBe('https://bitbucket.org/ws/repo/pull-requests/12');
  });

  it('throws on 4xx response with body detail', async () => {
    const fetchImpl = vi.fn(async () => response(401, 'Unauthorized', 'Unauthorized'));

    await expect(
      createBitbucketPullRequest({
        workspace: 'ws',
        repo: 'repo',
        title: 'T',
        sourceBranch: 'factory/x',
        targetBranch: 'main',
        username: 'ada',
        appPassword: 'secret',
        fetchImpl,
      }),
    ).rejects.toThrow('Bitbucket PR creation failed: 401');
  });

  it('throws when no credentials are provided', async () => {
    const fetchImpl = vi.fn();
    const prev = {
      user: process.env.BITBUCKET_USERNAME,
      pass: process.env.BITBUCKET_APP_PASSWORD,
      token: process.env.BITBUCKET_TOKEN,
    };
    process.env.BITBUCKET_USERNAME = '';
    process.env.BITBUCKET_APP_PASSWORD = '';
    process.env.BITBUCKET_TOKEN = '';

    try {
      await expect(
        createBitbucketPullRequest({
          workspace: 'ws',
          repo: 'repo',
          title: 'T',
          sourceBranch: 'factory/x',
          targetBranch: 'main',
          fetchImpl,
        }),
      ).rejects.toThrow('credentials required');
    } finally {
      if (prev.user !== undefined) process.env.BITBUCKET_USERNAME = prev.user;
      if (prev.pass !== undefined) process.env.BITBUCKET_APP_PASSWORD = prev.pass;
      if (prev.token !== undefined) process.env.BITBUCKET_TOKEN = prev.token;
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
