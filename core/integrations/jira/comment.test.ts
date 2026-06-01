import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postJiraComment } from './comment.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postJiraComment', () => {
  const baseInput = {
    externalId: 'PROJ-42',
    repoRef: null,
    text: 'Test comment',
    baseUrl: 'https://example.atlassian.net',
    email: 'user@example.com',
    token: 'test-token',
  };

  it('POSTs to the correct Jira comment URL with correct auth and ADF body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'comment-123',
        self: 'https://example.atlassian.net/rest/api/3/issue/PROJ-42/comment/comment-123',
      }),
    });

    const result = await postJiraComment(baseInput);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.atlassian.net/rest/api/3/issue/PROJ-42/comment',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from('user@example.com:test-token').toString('base64')}`,
        }),
        body: expect.stringContaining('"type":"text"'),
      }),
    );
    expect(result).toEqual({
      ok: true,
      commentId: 'comment-123',
      url: 'https://example.atlassian.net/rest/api/3/issue/PROJ-42/comment/comment-123',
    });
  });

  it('strips trailing slash from baseUrl', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 'c-1', self: null }),
    });

    await postJiraComment({ ...baseInput, baseUrl: 'https://example.atlassian.net/' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.atlassian.net/rest/api/3/issue/PROJ-42/comment',
      expect.anything(),
    );
  });

  it('returns ok:false with httpStatus on non-201 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ errorMessages: ['Issue does not exist'], errors: {} }),
    });

    const result = await postJiraComment(baseInput);

    expect(result).toEqual({
      ok: false,
      httpStatus: 404,
      detail: expect.stringContaining('Issue does not exist'),
    });
  });

  it('returns ok:false on fetch network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const result = await postJiraComment(baseInput);

    expect(result).toEqual({ ok: false, httpStatus: 0, detail: 'Network failure' });
  });

  it('returns null url when self is absent', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 'c-1' }),
    });

    const result = await postJiraComment(baseInput);

    expect(result).toMatchObject({ ok: true, commentId: 'c-1', url: null });
  });
});
