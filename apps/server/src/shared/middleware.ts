import { logger } from '@goose-hub/core/logger.js';
import type { Context } from 'hono';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; error: Response };

function isObjectPayload(data: unknown): data is Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data);
}

export async function parseBody<T>(c: Context): Promise<ParsedBody<T>> {
  try {
    const data = await c.req.json();
    if (!isObjectPayload(data)) {
      logger.warn('request body parse failed', { err: 'request body must be a JSON object' });
      return { ok: false, error: c.json({ error: 'invalid request body' }, 400) };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    logger.warn('request body parse failed', { err: String(err) });
    return { ok: false, error: c.json({ error: 'invalid request body' }, 400) };
  }
}
