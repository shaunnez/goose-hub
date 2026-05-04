import { Hono } from 'hono';
import { parseBody } from '#shared/middleware.js';
import { createInboxItem, deleteInboxItem, getInboxItems, promoteInboxItem } from './service.js';

const router = new Hono();

router.post('/', async (c) => {
  const body = await parseBody<{ title?: string; body?: string; type?: string }>(c);
  if (!body.ok) return body.error;
  const result = await createInboxItem(body.data.title, body.data.body, body.data.type);
  return result.ok
    ? c.json(result.data, 201)
    : c.json({ error: result.error }, result.status as 400);
});

router.get('/', async (c) => {
  const result = await getInboxItems();
  return result.ok ? c.json(result.data) : c.json({ items: [] });
});

router.post('/:id/promote', async (c) => {
  const id = Number(c.req.param('id'));
  if (Number.isNaN(id)) return c.json({ error: 'invalid id' }, 400);
  const body = await parseBody<{ projectSlug?: string; milestoneNumber?: number | null }>(c);
  if (!body.ok) return body.error;
  const slug = body.data.projectSlug ?? 'goose-hub-self';
  const milestoneNumber = body.data.milestoneNumber;
  const result = await promoteInboxItem(id, slug, milestoneNumber);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404);
});

router.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (Number.isNaN(id)) return c.json({ error: 'invalid id' }, 400);
  const result = await deleteInboxItem(id);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

export { router as inboxRouter };
