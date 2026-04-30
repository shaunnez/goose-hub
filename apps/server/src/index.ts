import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { buildSseStream } from '../../../core/event-stream/sse.js';
import { eventStore } from '../../../core/event-stream/store.js';
import type { StateName } from '../../../core/state-machine/states.js';
import { isLegalTransition, legalTargets } from '../../../core/state-machine/transitions.js';
import { readActiveMilestone, writeActiveMilestone } from './active-milestone.js';
import { getProject, listProjects } from './projects.js';
import { getSourceForSlug } from './source.js';

const app = new Hono();
app.use('*', cors());

app.get('/health', (c) => c.json({ ok: true }));

app.get('/projects', async (c) => {
  const projects = await listProjects();
  return c.json({ projects });
});

app.get('/projects/:slug/issues', async (c) => {
  const slug = c.req.param('slug');
  const source = await getSourceForSlug(slug);
  if (source == null) return c.json({ error: 'project not found' }, 404);
  const items = await source.listOpenWork();
  return c.json({ items });
});

app.get('/projects/:slug/issues/:id', async (c) => {
  const slug = c.req.param('slug');
  const id = c.req.param('id');
  const source = await getSourceForSlug(slug);
  if (source == null) return c.json({ error: 'project not found' }, 404);
  const item = await source.getItem(id);
  return c.json({ item });
});

app.get('/projects/:slug/milestones', async (c) => {
  const slug = c.req.param('slug');
  const source = await getSourceForSlug(slug);
  if (source == null) return c.json({ error: 'project not found' }, 404);
  const milestones = await source.listMilestones();
  return c.json({ milestones });
});

app.get('/projects/:slug/active-milestone', async (c) => {
  const slug = c.req.param('slug');
  const source = await getSourceForSlug(slug);
  if (source == null) return c.json({ error: 'project not found' }, 404);
  const projectId = slug;
  const persisted = await readActiveMilestone(projectId);
  if (persisted != null) return c.json({ milestoneNumber: persisted, source: 'project_state' });
  const fallback = await source.getActiveMilestone();
  return c.json({ milestoneNumber: fallback?.number ?? null, source: 'github-default' });
});

app.post('/projects/:slug/active-milestone', async (c) => {
  const slug = c.req.param('slug');
  const body = (await c.req.json().catch(() => ({}))) as { milestoneNumber?: number | null };
  const projectId = slug;
  await writeActiveMilestone(projectId, body.milestoneNumber ?? null, 'ui');
  eventStore.appendEvent({
    projectId,
    kind: 'milestone.activated',
    payload: { milestoneNumber: body.milestoneNumber ?? null },
  });
  return c.json({ ok: true, milestoneNumber: body.milestoneNumber ?? null });
});

app.get('/projects/:slug/issues/:id/events', async (c) => {
  const slug = c.req.param('slug');
  const id = c.req.param('id');
  const projectId = slug;
  const cfg = await getProject(slug);
  const repoRef = cfg?.source.kind === 'github' ? cfg.source.repo : slug;
  const workItemId = `github:${repoRef}#${id}`;
  const ascending = eventStore.replay({ projectId, workItemId });
  // #34 acceptance: ordered by createdAt desc (newest first).
  const events = [...ascending].reverse();
  return c.json({ events });
});

app.post('/projects/:slug/issues/:id/transition', async (c) => {
  const slug = c.req.param('slug');
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { from?: string; to?: string };
  const from = body.from as StateName | undefined;
  const to = body.to as StateName | undefined;
  if (from == null || to == null) {
    return c.json({ error: "missing 'from' or 'to'" }, 400);
  }
  if (!isLegalTransition(from, to)) {
    const legal = legalTargets(from);
    return c.json({ error: 'illegal transition', from, to, legalTargets: legal }, 422);
  }

  const source = await getSourceForSlug(slug);
  if (source == null) return c.json({ error: 'project not found' }, 404);

  const projectId = slug;
  const workItemId = `github:${source.repoRef}#${id}`;
  await source.transitionState(workItemId, from, to);

  eventStore.appendEvent({
    projectId,
    workItemId,
    kind: 'state.transitioned',
    payload: { from, to, by: 'ui' },
  });

  return c.json({ ok: true, from, to });
});

app.get('/events', (c) => {
  const projectId = c.req.query('projectId') ?? undefined;
  const workItemId = c.req.query('workItemId') ?? undefined;
  const lastEventIdHeader = c.req.header('Last-Event-ID');
  const lastEventIdQuery = c.req.query('lastEventId');
  const lastEventId = lastEventIdHeader ?? lastEventIdQuery;
  const sinceId = lastEventId != null ? Number.parseInt(lastEventId, 10) : undefined;

  const stream = buildSseStream(
    { projectId, workItemId },
    Number.isNaN(sinceId) ? undefined : sinceId,
  );

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port });
console.log(`apps/server listening on http://localhost:${port}`);

export { app };
