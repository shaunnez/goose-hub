import { Hono } from 'hono';
import { parseBody } from '#shared/middleware.js';
import {
  deleteConversationService,
  fetchConversation,
  listConversationsService,
  listToolManifests,
  postUserMessage,
  resolveProposal,
  startConversation,
} from './service.js';

const router = new Hono();

router.get('/manifest', (c) => {
  return c.json({
    tools: listToolManifests().map((m) => ({
      name: m.name,
      description: m.description,
      mutating: m.mutating,
    })),
  });
});

router.post('/conversations', async (c) => {
  const body = await parseBody<{
    scope?: 'global' | 'project' | 'item';
    projectSlug?: string;
    workItemId?: string;
    runtime?: 'claude' | 'codex';
  }>(c);
  if (!body.ok) return body.error;
  const result = await startConversation(body.data);
  return result.ok
    ? c.json(result.data, 201)
    : c.json({ error: result.error }, result.status as 400 | 404);
});

router.get('/conversations', async (c) => {
  const scope = c.req.query('scope') as 'global' | 'project' | 'item' | undefined;
  const projectSlug = c.req.query('projectSlug') ?? undefined;
  const workItemId = c.req.query('workItemId') ?? undefined;
  const result = await listConversationsService({ scope, projectSlug, workItemId });
  return result.ok ? c.json(result.data) : c.json({ conversations: [] });
});

router.get('/conversations/:id', async (c) => {
  const result = await fetchConversation(c.req.param('id'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.delete('/conversations/:id', async (c) => {
  const result = await deleteConversationService(c.req.param('id'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.post('/conversations/:id/messages', async (c) => {
  const body = await parseBody<{ content?: string }>(c);
  if (!body.ok) return body.error;
  if (!body.data.content) return c.json({ error: 'content required' }, 400);
  const result = await postUserMessage({
    conversationId: c.req.param('id'),
    content: body.data.content,
  });
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404 | 409);
});

router.post('/conversations/:id/invocations/:invocationId', async (c) => {
  const body = await parseBody<{ decision?: 'approve' | 'reject' }>(c);
  if (!body.ok) return body.error;
  if (body.data.decision !== 'approve' && body.data.decision !== 'reject')
    return c.json({ error: 'decision must be approve or reject' }, 400);
  const result = await resolveProposal({
    conversationId: c.req.param('id'),
    invocationId: c.req.param('invocationId'),
    decision: body.data.decision,
  });
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404 | 409);
});

export { router as chatRouter };
