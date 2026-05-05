import { Hono } from 'hono';
import { listProjectConfigsService, listProjectsService } from './service.js';

const router = new Hono();

router.get('/health', (c) => c.json({ ok: true }));

router.get('/projects', async (c) => {
  const result = await listProjectsService();
  return c.json(result);
});

router.get('/projects/configs', async (c) => {
  const result = await listProjectConfigsService();
  return c.json(result);
});

export { router as projectsRouter };
