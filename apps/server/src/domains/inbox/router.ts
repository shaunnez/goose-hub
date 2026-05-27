import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '#shared/middleware.js';
import { createInboxItem, deleteInboxItem, getInboxItems, promoteInboxItem } from './service.js';

const CreateInboxBodySchema = z.object({
  title: z.string().trim().min(1, 'title is required'),
  body: z.string().optional().default(''),
  type: z.enum(['feature', 'bug', 'chore', 'research']).optional().default('feature'),
});

const router = new Hono();

router.post('/', async (c) => {
  const body = await parseBody<{ title?: string; body?: string; type?: string }>(c);
  if (!body.ok) return body.error;

  const result = CreateInboxBodySchema.safeParse(body.data);
  if (!result.success) {
    return c.json({ error: 'validation failed', issues: result.error.issues }, 400);
  }

  const createResult = await createInboxItem(result.data.title, result.data.body, result.data.type);
  return createResult.ok
    ? c.json(createResult.data, 201)
    : c.json({ error: createResult.error }, createResult.status as 400);
});

router.get('/', async (c) => {
  const result = await getInboxItems();
  return result.ok ? c.json(result.data) : c.json({ items: [] });
});

router.post('/:id/promote', async (c) => {
  const id = Number(c.req.param('id'));
  if (Number.isNaN(id)) return c.json({ error: 'invalid id' }, 400);
  const body = await parseBody<{
    projectSlug?: string;
    milestoneNumber?: number | null;
    enhance?: boolean;
  }>(c);
  if (!body.ok) return body.error;
  const slug = body.data.projectSlug ?? 'goose-hub-self';
  const milestoneNumber = body.data.milestoneNumber;
  const enhance = body.data.enhance === true;
  const result = await promoteInboxItem(id, slug, milestoneNumber, enhance);
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
