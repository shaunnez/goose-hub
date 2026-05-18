import { Hono } from 'hono';
import { getChangelog, parseDays } from './service.js';

const router = new Hono();

router.get('/', async (c) => {
  const days = parseDays(c.req.query('days'));
  const result = await getChangelog(days);
  return result.ok
    ? c.json(result.data.entries)
    : c.json({ error: result.error }, result.status as 500);
});

export { router as changelogRouter };
