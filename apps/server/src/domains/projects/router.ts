import { Hono } from 'hono';
import { z } from 'zod';
import { coachSkillService, listProjectConfigsService, listProjectsService } from './service.js';

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

const CoachInputSchema = z.object({
  targetSkillName: z.string().min(1),
  patternIds: z.array(z.string()).min(1),
  lifecycleIds: z.array(z.string()).optional(),
});

router.post('/projects/:slug/coach', async (c) => {
  const slug = c.req.param('slug');

  const body = await c.req.json().catch(() => ({}));
  const parsed = CoachInputSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const result = await coachSkillService(slug, parsed.data);
  return result.ok ? c.json({ ok: true }) : c.json({ error: result.error }, 500);
});

export { router as projectsRouter };
