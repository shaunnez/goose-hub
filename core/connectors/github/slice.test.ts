import { describe, expect, it, vi } from 'vitest';
import { openPR, validatePrBody } from './open-pr.js';

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

  it('rejects empty title', async () => {
    await expect(openPR({ ...baseInput, title: '', gitExec: () => '' })).rejects.toThrow(
      /title must be 1–70 chars/,
    );
  });

  it('rejects titles longer than 70 chars', async () => {
    await expect(
      openPR({ ...baseInput, title: 'M7.99: ' + 'x'.repeat(80), gitExec: () => '' }),
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
});
