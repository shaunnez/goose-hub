import type { PostBackAdapterInput, PostBackAdapterResult } from '../post-back/types.js';

interface JiraCredentials {
  baseUrl: string;
  email: string;
  token: string;
}

export async function postJiraComment(
  input: PostBackAdapterInput & JiraCredentials,
): Promise<PostBackAdapterResult> {
  const url = `${input.baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${input.externalId}/comment`;
  const auth = Buffer.from(`${input.email}:${input.token}`).toString('base64');

  const body = JSON.stringify({
    body: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: input.text }],
        },
      ],
    },
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body,
    });

    const json = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const messages = Array.isArray(json.errorMessages)
        ? (json.errorMessages as string[]).join('; ')
        : JSON.stringify(json);
      return { ok: false, httpStatus: response.status, detail: messages };
    }

    const commentId = String(json.id ?? '');
    const commentUrl = typeof json.self === 'string' ? json.self : null;
    return { ok: true, commentId, url: commentUrl };
  } catch (err) {
    return {
      ok: false,
      httpStatus: 0,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
