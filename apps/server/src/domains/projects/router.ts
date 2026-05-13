import { makeConfluenceFetcher } from '@goose-hub/core/connectors/confluence.js';
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

// M14.05 / #324 — return a Confluence page title for a given pageId. Used
// by the task detail panel's Confluence-links section to render labelled
// links rather than raw URLs. Returns `{ title: null }` when credentials
// are not configured so the client knows to fall back to the URL slug.
router.get('/confluence/title', async (c) => {
  const pageId = c.req.query('pageId');
  if (pageId == null || !/^\d+$/.test(pageId)) {
    return c.json({ title: null, error: 'invalid pageId' }, 400);
  }
  const fetcher = makeConfluenceFetcher();
  if (fetcher == null) {
    return c.json({ title: null, available: false });
  }
  try {
    const title = await fetcher.fetchTitle(pageId);
    return c.json({ title, available: true });
  } catch {
    return c.json({ title: null, available: true });
  }
});

export { router as projectsRouter };
