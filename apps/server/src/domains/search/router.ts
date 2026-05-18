import { Hono } from 'hono';
import { parseIncludeClosed, parseLimit, parseMilestone, parseType, search } from './service.js';

const router = new Hono();

router.get('/', async (c) => {
  const q = c.req.query('q') ?? '';
  const limit = parseLimit(c.req.query('limit'));
  const projectSlug = c.req.query('projectSlug') || undefined;
  const type = parseType(c.req.query('type'));
  const milestone = parseMilestone(c.req.query('milestone'));
  const includeClosed = parseIncludeClosed(c.req.query('includeClosed'));
  const result = await search({ q, limit, projectSlug, type, milestone, includeClosed });
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 500);
});

export { router as searchRouter };
