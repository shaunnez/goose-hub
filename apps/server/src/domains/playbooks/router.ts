import { Hono } from 'hono';
import { parseBody } from '#shared/middleware.js';
import { type CreatePlaybookRequest, createPlaybookService } from './service.js';

const router = new Hono();

router.post('/:slug/playbooks', async (c) => {
  const body = await parseBody<CreatePlaybookRequest>(c);
  if (!body.ok) return body.error;

  const result = await createPlaybookService(c.req.param('slug'), body.data);
  return result.ok
    ? c.json(result.data, 202)
    : c.json({ error: result.error }, result.status as 400 | 404 | 500);
});

export { router as playbooksRouter };
