import { logger } from '@goose-hub/core/logger.js';
import { Hono } from 'hono';
import { parseBody } from '#shared/middleware.js';
import { createPlaybook, getPlaybook, listPlaybooks } from './service.js';

const router = new Hono();

router.get('/:slug/playbooks', async (c) => {
  const slug = c.req.param('slug');
  const result = await listPlaybooks(slug);
  return result.ok ? c.json(result.data) : c.json({ playbooks: [] });
});

router.get('/:slug/playbooks/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
  const result = await getPlaybook(id);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.post('/:slug/playbooks', async (c) => {
  const slug = c.req.param('slug');
  const body = await parseBody<{
    windowSize?: number;
    dateRange?: { startAt?: string; endAt?: string };
  }>(c);
  if (!body.ok) return body.error;

  const dateRange =
    body.data.dateRange?.startAt != null && body.data.dateRange.endAt != null
      ? { startAt: body.data.dateRange.startAt, endAt: body.data.dateRange.endAt }
      : undefined;

  try {
    const result = await createPlaybook(slug, {
      windowSize: body.data.windowSize,
      dateRange,
    });
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 400 | 500);
    }
    return c.json(result.data, 201);
  } catch (err) {
    logger.error('createPlaybook failed', { slug, error: String(err) });
    return c.json({ error: String(err) }, 500);
  }
});

export { router as playbooksRouter };
