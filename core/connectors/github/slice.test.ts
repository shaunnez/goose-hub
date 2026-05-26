import { describe, expect, it, vi } from 'vitest';
import { MergeConflictError, mergePR } from './merge-pr.js';
import { openLocalDbPR, openPR, validatePrBody } from './open-pr.js';

describe('validatePrBody (#184)', () => {
  it('accepts a body with Closes #N on its own line', () => {
    expect(() => validatePrBody('Some summary\n\nCloses #42\n', 42)).not.toThrow();
  });

  it('rejects when Closes #N is missing', () => {
    expect(() => validatePrBody('Just a summary, no closes line.', 42)).toThrow(
      /must contain `Closes #N` on its own line/,
    );
  });

  it('rejects when Closes #N references a different issue', () => {
    expect(() => validatePrBody('Closes #99\n', 42)).toThrow(/does not match expected issue #42/);
  });

  it('rejects Closes #N inline with other text (must be on its own line)', () => {
    expect(() => validatePrBody('Done. Closes #42 inline.', 42)).toThrow();
  });
});

describe('openPR (#184)', () => {
  const baseInput = {
    worktreePath: '/work/wt',
    repo: 'shaunnez/goose-hub',
    issueNumber: 42,
    title: 'M7.05: example chore',
    body: '## Summary\n\nDone\n\nCloses #42\n',
    branchName: 'factory/run-abc',
    token: 'ghp_test',
  } as const;

  it('pushes HEAD to the feature branch and POSTs to /pulls', async () => {
    const gitExec = vi.fn().mockReturnValue('');
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ number: 999, html_url: 'https://github.com/x/y/pull/999' }), {
        status: 201,
      }),
    ) as unknown as typeof fetch;

    const result = await openPR({ ...baseInput, gitExec, fetchImpl });

    expect(gitExec).toHaveBeenCalledWith(
      ['push', '--force-with-lease', 'origin', 'HEAD:refs/heads/factory/run-abc'],
      '/work/wt',
    );
    const fetchMock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/shaunnez/goose-hub/pulls');
    expect(opts.method).toBe('POST');
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ghp_test');
    const sent = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(sent.head).toBe('factory/run-abc');
    expect(sent.base).toBe('main');
    expect(sent.title).toBe('M7.05: example chore');

    expect(result.prNumber).toBe(999);
    expect(result.prUrl).toBe('https://github.com/x/y/pull/999');
    expect(result.branch).toBe('factory/run-abc');
    expect(result.base).toBe('main');
  });

  it('honours an explicit base branch', async () => {
    const gitExec = vi.fn().mockReturnValue('');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ number: 1, html_url: 'https://example/1' }), { status: 201 }),
      ) as unknown as typeof fetch;
    await openPR({ ...baseInput, baseBranch: 'develop', gitExec, fetchImpl });
    const sent = JSON.parse(
      ((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit)
        .body as string,
    ) as Record<string, unknown>;
    expect(sent.base).toBe('develop');
  });

  it('can open a PR without pushing when the branch was already verified', async () => {
    const gitExec = vi.fn().mockReturnValue('');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ number: 2, html_url: 'https://example/2' }), { status: 201 }),
      ) as unknown as typeof fetch;

    await openPR({ ...baseInput, skipPush: true, gitExec, fetchImpl });

    expect(gitExec).not.toHaveBeenCalled();
    const sent = JSON.parse(
      ((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit)
        .body as string,
    ) as Record<string, unknown>;
    expect(sent.head).toBe('factory/run-abc');
  });

  it('rejects empty title', async () => {
    await expect(openPR({ ...baseInput, title: '', gitExec: () => '' })).rejects.toThrow(
      /title must be 1–70 chars/,
    );
  });

  it('rejects titles longer than 70 chars', async () => {
    await expect(
      openPR({ ...baseInput, title: `M7.99: ${'x'.repeat(80)}`, gitExec: () => '' }),
    ).rejects.toThrow(/title must be 1–70 chars/);
  });

  it('rejects body without Closes #N', async () => {
    await expect(openPR({ ...baseInput, body: 'Summary only', gitExec: () => '' })).rejects.toThrow(
      /must contain `Closes #N`/,
    );
  });

  it('rejects body with mismatched Closes #N', async () => {
    await expect(openPR({ ...baseInput, body: 'Closes #99\n', gitExec: () => '' })).rejects.toThrow(
      /does not match expected issue #42/,
    );
  });

  it('throws when GitHub returns non-2xx', async () => {
    const gitExec = vi.fn().mockReturnValue('');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('rate limit exceeded', { status: 403, statusText: 'Forbidden' }),
      ) as unknown as typeof fetch;
    await expect(openPR({ ...baseInput, gitExec, fetchImpl })).rejects.toThrow(
      /403 Forbidden — rate limit exceeded/,
    );
  });

  it('opens a local-db PR without requiring a closing GitHub issue line', async () => {
    const gitExec = vi.fn().mockReturnValue('');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ number: 3, html_url: 'https://example/3' }), { status: 201 }),
      ) as unknown as typeof fetch;

    await expect(
      openLocalDbPR({
        worktreePath: '/work/wt',
        repo: 'shaunnez/goose-hub',
        title: 'M7.05: example chore',
        body: '## Summary\n\nLocal Work Item: local:proj#1\n',
        branchName: 'factory/run-abc',
        token: 'ghp_test',
        gitExec,
        fetchImpl,
      }),
    ).resolves.toMatchObject({ prNumber: 3 });
  });
});

describe('defaultGitExec via openPR without gitExec override', () => {
  const baseInput = {
    worktreePath: '/work/wt',
    repo: 'shaunnez/goose-hub',
    issueNumber: 42,
    title: 'M7.05: example chore',
    body: '## Summary\n\nDone\n\nCloses #42\n',
    branchName: 'factory/run-abc',
    token: 'ghp_test',
  } as const;

  it('throws when git is invoked on a non-existent path (exercises defaultGitExec)', async () => {
    // Don't supply gitExec — this exercises the defaultGitExec branch (lines 109-111).
    // It will call execFileSync('git', [...]) with a non-existent cwd and throw.
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      openPR({
        ...baseInput,
        worktreePath: '/path/that/does/not/exist/for/test',
        fetchImpl,
        // no gitExec — exercises defaultGitExec
      }),
    ).rejects.toThrow();
    // fetchImpl should NOT have been called (failure is in the git push step)
    const fetchMock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('mergePR (#186)', () => {
  it('PUTs to /pulls/N/merge with merge method, returns sha + merged', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sha: 'abc1234', merged: true }), { status: 200 }),
      ) as unknown as typeof fetch;
    const result = await mergePR({
      repo: 'owner/repo',
      prNumber: 99,
      token: 'ghp_test',
      fetchImpl,
    });
    expect(result.sha).toBe('abc1234');
    expect(result.merged).toBe(true);

    const fetchMock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/owner/repo/pulls/99/merge');
    expect(opts.method).toBe('PUT');
    const sent = JSON.parse(opts.body as string) as { merge_method: string };
    expect(sent.merge_method).toBe('merge');
  });

  it('honours an explicit merge method (squash)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sha: 'def5678', merged: true }), { status: 200 }),
      ) as unknown as typeof fetch;
    await mergePR({
      repo: 'owner/repo',
      prNumber: 99,
      token: 'ghp_test',
      mergeMethod: 'squash',
      fetchImpl,
    });
    const sent = JSON.parse(
      ((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit)
        .body as string,
    ) as { merge_method: string };
    expect(sent.merge_method).toBe('squash');
  });

  it('throws MergeConflictError (not generic Error) on 405', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('not mergeable', { status: 405, statusText: 'Method Not Allowed' }),
      ) as unknown as typeof fetch;
    await expect(
      mergePR({ repo: 'owner/repo', prNumber: 99, token: 'ghp_test', fetchImpl }),
    ).rejects.toBeInstanceOf(MergeConflictError);
  });

  it('MergeConflictError carries the prNumber', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('not mergeable', { status: 405, statusText: 'Method Not Allowed' }),
      ) as unknown as typeof fetch;
    const err = await mergePR({
      repo: 'owner/repo',
      prNumber: 77,
      token: 'ghp_test',
      fetchImpl,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MergeConflictError);
    expect((err as MergeConflictError).prNumber).toBe(77);
  });

  it('still throws generic Error on other non-2xx (e.g. 403)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('rate limited', { status: 403, statusText: 'Forbidden' }),
      ) as unknown as typeof fetch;
    const err = await mergePR({
      repo: 'owner/repo',
      prNumber: 1,
      token: 'ghp_test',
      fetchImpl,
    }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(MergeConflictError);
    expect(String(err)).toContain('403');
  });
});
