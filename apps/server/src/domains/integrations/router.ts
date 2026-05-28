import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '#shared/middleware.js';
import { resolveCanonicalWorkItemForRoute } from '#shared/work-item-resolution.js';
import {
  type JiraAssignedImportRequestDto,
  type JiraImportRequestDto,
  importAssignedJiraIssues,
  importJiraIssue,
} from './service.js';
import { checkPostBackAvailability, executePostBack } from './post-back.js';

const PostBackBodySchema = z.object({
  kind: z.enum(['prd-summary', 'investigation-summary', 'pr-link', 'needs-human']),
  provider: z.enum(['jira', 'bitbucket']),
  text: z.string().min(1).max(10_000),
});

const router = new Hono();

router.post('/:slug/integrations/jira/import', async (c) => {
  const body = await parseBody<JiraImportRequestDto>(c);
  if (!body.ok) return body.error;
  const result = await importJiraIssue(c.req.param('slug'), body.data);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 401 | 403 | 404 | 429 | 502);
});

router.post('/:slug/integrations/jira/import-assigned-to-me', async (c) => {
  const body = await parseBody<JiraAssignedImportRequestDto>(c);
  if (!body.ok) return body.error;
  const result = await importAssignedJiraIssues(c.req.param('slug'), body.data);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 401 | 403 | 404 | 429 | 502);
});

router.get('/:slug/issues/:id/integrations/post-back/availability', async (c) => {
  const resolved = await resolveCanonicalWorkItemForRoute(
    c.req.param('slug'),
    c.req.param('id'),
  );
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status as 400 | 404);

  if (!resolved.data.isLocalDb) {
    return c.json({ availability: { jira: false, bitbucket: false } });
  }

  const availability = checkPostBackAvailability(
    resolved.data.projectId,
    resolved.data.canonicalWorkItemId,
  );
  return c.json({ availability });
});

router.post('/:slug/issues/:id/integrations/post-back', async (c) => {
  const parsed = await parseBody<unknown>(c);
  if (!parsed.ok) return parsed.error;

  const body = PostBackBodySchema.safeParse(parsed.data);
  if (!body.success) {
    return c.json({ error: 'invalid request body', details: body.error.flatten() }, 400);
  }

  const resolved = await resolveCanonicalWorkItemForRoute(
    c.req.param('slug'),
    c.req.param('id'),
  );
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status as 400 | 404);

  if (!resolved.data.isLocalDb) {
    return c.json({ ok: false, error: 'no-ref', detail: 'post-back requires a local-db project' }, 422);
  }

  const result = await executePostBack({
    projectSlug: c.req.param('slug'),
    workItemId: resolved.data.canonicalWorkItemId,
    provider: body.data.provider,
    kind: body.data.kind,
    text: body.data.text,
  });

  if (!result.ok) {
    const status =
      result.error === 'no-ref' ||
      result.error === 'no-credentials' ||
      result.error === 'empty-text'
        ? 422
        : 502;
    return c.json(result, status);
  }

  return c.json(result, 200);
});

export { router as integrationsRouter };
