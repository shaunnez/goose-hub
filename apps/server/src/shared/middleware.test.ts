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

  it('returns ok:false with 400 response for JSON null', async () => {
    const app = new Hono();
    let result: unknown;
    app.post('/test', async (c) => {
      result = await parseBody<{ name: string }>(c);
      return c.json({});
    });
    await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    expect(result).toMatchObject({ ok: false });
    const parsed = result as { ok: false; error: Response };
    expect(parsed.error.status).toBe(400);
    await expect(parsed.error.json()).resolves.toEqual({ error: 'invalid request body' });
  });
});
