import { Hono } from 'hono';
import { parseBody } from '#shared/middleware.js';
import { decideIntervention, getInterventionDetail, listProjectInterventions } from './service.js';

const projectInterventionsRouter = new Hono();
const interventionsRouter = new Hono();

projectInterventionsRouter.get('/:slug/interventions', async (c) => {
  const result = await listProjectInterventions(c.req.param('slug'), c.req.query('status'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

interventionsRouter.get('/:id', async (c) => {
  const result = await getInterventionDetail(c.req.param('id'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

interventionsRouter.post('/:id/decide', async (c) => {
  const body = await parseBody<{
    actionType?: unknown;
    actionPayload?: unknown;
    decidedBy?: unknown;
    reason?: unknown;
    expectedVersion?: unknown;
  }>(c);
  if (!body.ok) return body.error;
  const result = await decideIntervention(c.req.param('id'), body.data);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404 | 409 | 422);
});

export { interventionsRouter, projectInterventionsRouter };
