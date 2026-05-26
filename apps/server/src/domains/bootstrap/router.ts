/**
 * Bootstrap router — exposes preview + run endpoints for the bootstrap
 * wizard UI (M12.07, issue #308).
 *
 * Routes (mounted at `/projects` in `server.ts`):
 *   - POST /projects/bootstrap/preview { repoRef }            → BootstrapPreviewDto
 *   - POST /projects/bootstrap/run     { repoRef, slug? }     → BootstrapRunDto
 *
 * The token comes from the server env (`GITHUB_TOKEN`); the browser does
 * NOT supply tokens. When `MOCK_BOOTSTRAP=true`, both endpoints return
 * deterministic fixture payloads (used by the Playwright e2e test).
 */

import { Hono } from 'hono';
import { parseBody } from '#shared/middleware.js';
import { previewBootstrapService, runBootstrapService } from './service.js';

const router = new Hono();

router.post('/bootstrap/preview', async (c) => {
  const body = await parseBody<{
    repoRef?: string;
    repoRefs?: string[];
    slug?: string;
    name?: string;
  }>(c);
  if (!body.ok) return body.error;
  const result = await previewBootstrapService(body.data);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404 | 500 | 502);
});

router.post('/bootstrap/run', async (c) => {
  const body = await parseBody<{
    repoRef?: string;
    repoRefs?: string[];
    slug?: string;
    name?: string;
  }>(c);
  if (!body.ok) return body.error;
  const result = await runBootstrapService(body.data);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404 | 500 | 502);
});

export { router as bootstrapRouter };
