import { WORKFLOW_CATALOG } from '@goose-hub/core/workflows/workflow-catalog.js';
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

router.get('/workflow-catalog', (c) => {
  return c.json({ catalog: WORKFLOW_CATALOG });
});

export { router as projectsRouter };
