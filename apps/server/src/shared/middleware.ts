import { logger } from '@goose-hub/core/logger.js';
import type { Context } from 'hono';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; error: Response };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function parseBody<T>(c: Context): Promise<ParsedBody<T>> {
  try {
    const data = await c.req.json();
    if (!isPlainObject(data)) {
      return { ok: false, error: c.json({ error: 'invalid request body' }, 400) };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    logger.warn('request body parse failed', { err: String(err) });
    return { ok: false, error: c.json({ error: 'invalid request body' }, 400) };
  }
}
