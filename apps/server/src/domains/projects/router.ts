import { Hono } from 'hono';
import { listProjects } from '../../shared/projects.js';

const router = new Hono();

router.get('/health', (c) => c.json({ ok: true }));

router.get('/projects', async (c) => {
  const projects = await listProjects();
  return c.json({ projects });
});

export { router as projectsRouter };
