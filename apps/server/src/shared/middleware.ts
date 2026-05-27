import { logger } from '@goose-hub/core/logger.js';
import type { Context } from 'hono';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export type ParsedBody<T extends Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; error: Response };

export async function parseBody<T>(
  c: Context,
): Promise<ParsedBody<T extends Record<string, unknown> ? T : Record<string, unknown>>> {
  try {
    const data = await c.req.json();
    if (data === null || Array.isArray(data) || typeof data !== 'object') {
      logger.warn('request body parse failed', {
        err: 'Error: request body must be a JSON object',
      });
      return { ok: false, error: c.json({ error: 'invalid request body' }, 400) };
    }

    return {
      ok: true,
      data: data as T extends Record<string, unknown> ? T : Record<string, unknown>,
    };
  } catch (err) {
    logger.warn('request body parse failed', { err: String(err) });
    return { ok: false, error: c.json({ error: 'invalid request body' }, 400) };
  }
}
