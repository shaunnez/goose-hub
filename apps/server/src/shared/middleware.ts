import { logger } from '@goose-hub/core/logger.js';
import type { Context } from 'hono';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; error: Response };

export async function parseBody<T>(c: Context): Promise<ParsedBody<T>> {
  try {
    const data = (await c.req.json()) as T;
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      logger.warn('request body parse failed', { err: 'request body must be a JSON object' });
      return { ok: false, error: c.json({ error: 'invalid request body' }, 400) };
    }
    return { ok: true, data };
  } catch (err) {
    logger.warn('request body parse failed', { err: String(err) });
    return { ok: false, error: c.json({ error: 'invalid request body' }, 400) };
  }
}
