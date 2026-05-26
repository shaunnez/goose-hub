import { resolveGlobalSettingsForProject } from '@goose-hub/core/agent-runtime/resolve-for-project.js';
import { Hono } from 'hono';
import { getProject } from '#shared/projects.js';
import { resolveWorkItemForRoute } from '#shared/work-item-resolution.js';
import { getCostSummary, getCostsForWorkItem, getToolStatsForWorkItem } from './service.js';

const router = new Hono();

/** Project-level summary: week/month windows + per-stage breakdown. */
router.get('/:slug/costs/summary', async (c) => {
  const slug = c.req.param('slug');
  const cfg = await getProject(slug);
  if (cfg == null) return c.json({ error: 'project not found' }, 404);

  const globalSettings = resolveGlobalSettingsForProject(slug, cfg.budgets);
  const result = await getCostSummary(slug, {
    dailyTokensLimit: globalSettings.dailyTokens ?? 0,
  });
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 400);
});

/** Per-task breakdown: every cost row scoped to a single work item. */
router.get('/:slug/issues/:id/costs', async (c) => {
  const slug = c.req.param('slug');
  const id = c.req.param('id');
  const resolved = await resolveWorkItemForRoute(slug, id);
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status as 400 | 404);
  const result = await getCostsForWorkItem(resolved.data.canonicalWorkItemId);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 400);
});

/** Per-task tool-intensity breakdown: every stats row scoped to a single work item. */
router.get('/:slug/issues/:id/tool-stats', async (c) => {
  const slug = c.req.param('slug');
  const id = c.req.param('id');
  const resolved = await resolveWorkItemForRoute(slug, id);
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status as 400 | 404);
  const result = await getToolStatsForWorkItem(resolved.data.canonicalWorkItemId);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 400);
});

export { router as costsRouter };
