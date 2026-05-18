import { Hono } from 'hono';
import { parseLimit, parseMilestone, parseType, search } from './service.js';

const router = new Hono();

router.get('/', async (c) => {
  const q = c.req.query('q') ?? '';
  const limit = parseLimit(c.req.query('limit'));
  const projectSlug = c.req.query('projectSlug') || undefined;
  const type = parseType(c.req.query('type'));
  const milestone = parseMilestone(c.req.query('milestone'));
  const result = await search({ q, limit, projectSlug, type, milestone });
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 500);
});

export { router as searchRouter };
