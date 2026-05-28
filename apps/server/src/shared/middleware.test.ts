import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { parseBody } from './middleware.js';

function makeApp() {
  const app = new Hono();
  let result: unknown;
  app.post('/test', async (c) => {
    result = await parseBody<{ name: string }>(c);
    return c.json({});
  });
  return { app, getResult: () => result };
}

describe('parseBody', () => {
  it('returns ok:true with parsed data for valid JSON', async () => {
    const { app, getResult } = makeApp();
    await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'hello' }),
    });
    expect(getResult()).toEqual({ ok: true, data: { name: 'hello' } });
  });

  it('returns ok:false with 400 response for invalid JSON', async () => {
    const { app, getResult } = makeApp();
    await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(getResult()).toMatchObject({ ok: false });
  });

  it.each([
    ['null', 'null'],
    ['array', JSON.stringify(['hello'])],
    ['string', JSON.stringify('hello')],
    ['number', JSON.stringify(42)],
    ['boolean', JSON.stringify(true)],
  ])('returns ok:false with 400 response for %s JSON payloads', async (_label, body) => {
    const { app, getResult } = makeApp();
    await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    expect(getResult()).toMatchObject({ ok: false });
  });
});
