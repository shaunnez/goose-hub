import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postBitbucketComment } from './comment.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  mockFetch.mockClear();
  vi.unstubAllGlobals();
});

describe('postBitbucketComment', () => {
  const baseInput = {
    externalId: '42',
    repoRef: 'myworkspace/my-repo',
    text: 'Test comment',
    username: 'bitbucket-user',
    token: 'app-password',
  };

  it('POSTs to the correct Bitbucket URL with Basic auth and raw body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        id: 99,
        links: {
          self: {
            href: 'https://api.bitbucket.org/2.0/repositories/myworkspace/my-repo/pullrequests/42/comments/99',
          },
        },
      }),
    });

    const result = await postBitbucketComment(baseInput);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.bitbucket.org/2.0/repositories/myworkspace/my-repo/pullrequests/42/comments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from('bitbucket-user:app-password').toString('base64')}`,
        }),
        body: JSON.stringify({ content: { raw: 'Test comment' } }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      commentId: '99',
      url: 'https://api.bitbucket.org/2.0/repositories/myworkspace/my-repo/pullrequests/42/comments/99',
    });
  });

  it('returns null url when links are absent from response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 99 }),
    });

    const result = await postBitbucketComment(baseInput);

    expect(result).toMatchObject({ ok: true, commentId: '99', url: null });
  });

  it('returns ok:false with httpStatus on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'Forbidden' } }),
    });

    const result = await postBitbucketComment(baseInput);

    expect(result).toEqual({ ok: false, httpStatus: 403, detail: 'Forbidden' });
  });

  it('returns ok:false on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await postBitbucketComment(baseInput);

    expect(result).toEqual({ ok: false, httpStatus: 0, detail: 'Connection refused' });
  });

  it('returns ok:false immediately when repoRef is null', async () => {
    const result = await postBitbucketComment({
      ...baseInput,
      repoRef: null,
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      httpStatus: 0,
      detail: expect.stringContaining('repoRef'),
    });
  });
});
