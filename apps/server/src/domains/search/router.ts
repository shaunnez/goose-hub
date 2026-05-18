import { Hono } from 'hono';
import { parseLimit, search } from './service.js';

const router = new Hono();

router.get('/', async (c) => {
  const q = c.req.query('q') ?? '';
  const limit = parseLimit(c.req.query('limit'));
  const result = await search({ q, limit });
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 500);
});

export { router as searchRouter };
