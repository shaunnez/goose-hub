import { Hono } from 'hono';
import { parseBody } from '#shared/middleware.js';
import { type JiraImportRequestDto, importJiraIssue } from './service.js';

const router = new Hono();

router.post('/:slug/integrations/jira/import', async (c) => {
  const body = await parseBody<JiraImportRequestDto>(c);
  if (!body.ok) return body.error;
  const result = await importJiraIssue(c.req.param('slug'), body.data);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 401 | 403 | 404 | 429 | 502);
});

export { router as integrationsRouter };
