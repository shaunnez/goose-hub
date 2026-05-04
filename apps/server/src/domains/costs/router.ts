import { Hono } from 'hono';
import { getProject } from '../../shared/projects.js';
import { getCostSummary, getCostsForWorkItem } from './service.js';

const router = new Hono();

/** Project-level summary: week/month windows + per-stage breakdown. */
router.get('/:slug/costs/summary', async (c) => {
  const slug = c.req.param('slug');
  const cfg = await getProject(slug);
  if (cfg == null) return c.json({ error: 'project not found' }, 404);

  const result = await getCostSummary(slug);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 400);
});

/** Per-task breakdown: every cost row scoped to a single work item. */
router.get('/:slug/issues/:id/costs', async (c) => {
  const slug = c.req.param('slug');
  const id = c.req.param('id');
  const cfg = await getProject(slug);
  if (cfg == null) return c.json({ error: 'project not found' }, 404);

  const repoRef = cfg.source.kind === 'github' ? cfg.source.repo : slug;
  const workItemId = `github:${repoRef}#${id}`;
  const result = await getCostsForWorkItem(workItemId);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 400);
});

export { router as costsRouter };
