import { logger } from '@goose-hub/core/logger.js';
import type { Context } from 'hono';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; error: Response };

function invalidRequestBody(c: Context) {
  return { ok: false, error: c.json({ error: 'invalid request body' }, 400) } as const;
}

export async function parseBody<T>(c: Context): Promise<ParsedBody<T>> {
  try {
    const data = await c.req.json();

    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return invalidRequestBody(c);
    }

    return { ok: true, data: data as T };
  } catch (err) {
    logger.warn('request body parse failed', { err: String(err) });
    return invalidRequestBody(c);
  }
}
