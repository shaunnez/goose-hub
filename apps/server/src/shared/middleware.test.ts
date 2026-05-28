import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { parseBody } from './middleware.js';

async function parseRequestBody(body: string) {
  const app = new Hono();
  let result: unknown;

  app.post('/test', async (c) => {
    result = await parseBody<{ name?: string }>(c);
    return c.json({});
  });

  await app.request('/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  return result;
}

describe('parseBody', () => {
  it('returns ok:true with parsed data for valid JSON', async () => {
    const result = await parseRequestBody(JSON.stringify({ name: 'hello' }));

    expect(result).toEqual({ ok: true, data: { name: 'hello' } });
  });

  it('returns ok:false with 400 response for invalid JSON', async () => {
    const result = await parseRequestBody('not-json');

    expect(result).toMatchObject({ ok: false });
  });

  it.each(['null', '[]', '"hello"', '123', 'true'])(
    'returns ok:false with 400 response for non-object JSON body %s',
    async (body) => {
      const result = await parseRequestBody(body);

      expect(result).toMatchObject({ ok: false });
    },
  );

  it('returns invalid request body response for non-object JSON values', async () => {
    const result = (await parseRequestBody('null')) as { ok: false; error: Response };

    expect(result).toMatchObject({ ok: false });
    expect(result.error.status).toBe(400);
    await expect(result.error.json()).resolves.toEqual({ error: 'invalid request body' });
  });
});
