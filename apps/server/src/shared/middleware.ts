import { logger } from '@goose-hub/core/logger.js';
import type { Context } from 'hono';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; error: Response };

export async function parseBody<T>(c: Context): Promise<ParsedBody<T>> {
  try {
    const parsed = await c.req.json();
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('request body must be a JSON object');
    }
    const data = parsed as T;
    return { ok: true, data };
  } catch (err) {
    logger.warn('request body parse failed', { err: String(err) });
    return { ok: false, error: c.json({ error: 'invalid request body' }, 400) };
  }
}
