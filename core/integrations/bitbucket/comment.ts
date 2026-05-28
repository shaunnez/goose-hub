import type { PostBackAdapterInput, PostBackAdapterResult } from '../post-back/types.js';

interface BitbucketCredentials {
  username: string;
  token: string;
}

export async function postBitbucketComment(
  input: PostBackAdapterInput & BitbucketCredentials,
): Promise<PostBackAdapterResult> {
  if (input.repoRef == null) {
    return { ok: false, httpStatus: 0, detail: 'repoRef is required for Bitbucket comments' };
  }

  const url = `https://api.bitbucket.org/2.0/repositories/${input.repoRef}/pullrequests/${input.externalId}/comments`;
  const auth = Buffer.from(`${input.username}:${input.token}`).toString('base64');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ content: { raw: input.text } }),
    });

    const json = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const error =
        (json.error as { message?: string } | undefined)?.message ?? JSON.stringify(json);
      return { ok: false, httpStatus: response.status, detail: error };
    }

    const commentId = String(json.id ?? '');
    const links = json.links as { self?: { href?: string } } | undefined;
    const commentUrl = typeof links?.self?.href === 'string' ? links.self.href : null;
    return { ok: true, commentId, url: commentUrl };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
