import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { parseBody } from './middleware.js';

describe('parseBody', () => {
  it('returns ok:true with parsed data for valid JSON', async () => {
    const app = new Hono();
    let result: unknown;
    app.post('/test', async (c) => {
      result = await parseBody<{ name: string }>(c);
      return c.json({});
    });
    await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'hello' }),
    });
    expect(result).toEqual({ ok: true, data: { name: 'hello' } });
  });

  it('returns ok:false with 400 response for invalid JSON', async () => {
    const app = new Hono();
    let result: unknown;
    app.post('/test', async (c) => {
      result = await parseBody<{ name: string }>(c);
      return c.json({});
    });
    await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(result).toMatchObject({ ok: false });
  });
});
