import { resolve } from 'node:path';
import { config } from 'dotenv';
config({ path: resolve(import.meta.dirname, '../../../.env') });

import { buildSseStream } from '@goose-hub/core/event-stream/sse.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import { isLegalTransition, legalTargets } from '@goose-hub/core/state-machine/transitions.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { readActiveMilestone, writeActiveMilestone } from './active-milestone.js';
import { bustCache, getCached } from './cache.js';
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
  const items = await getCached(`issues:${slug}`, 60_000, () => source.listOpenWork());
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

app.get('/projects/:slug/milestones/:milestone/closed-issues', async (c) => {
  const slug = c.req.param('slug');
  const milestone = Number(c.req.param('milestone'));
  if (Number.isNaN(milestone)) return c.json({ error: 'invalid milestone number' }, 400);
  const source = await getSourceForSlug(slug);
  if (source == null) return c.json({ error: 'project not found' }, 404);
  const items = await getCached(`closed-issues:${slug}:${milestone}`, 60_000, () =>
    source.listClosedWorkByMilestone(milestone),
  );
  return c.json({ items });
});

app.get('/projects/:slug/milestones/:milestone/issues', async (c) => {
  const slug = c.req.param('slug');
  const milestone = Number(c.req.param('milestone'));
  if (Number.isNaN(milestone)) return c.json({ error: 'invalid milestone number' }, 400);
  const source = await getSourceForSlug(slug);
  if (source == null) return c.json({ error: 'project not found' }, 404);
  const items = await getCached(`milestone-issues:${slug}:${milestone}`, 60_000, () =>
    source.listWorkByMilestone(milestone),
  );
  return c.json({ items });
});

app.get('/projects/:slug/milestones', async (c) => {
  const slug = c.req.param('slug');
  const source = await getSourceForSlug(slug);
  if (source == null) return c.json({ error: 'project not found' }, 404);
  const milestones = await getCached(`milestones:${slug}`, 60_000, () => source.listMilestones());
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

  bustCache(`issues:${slug}`);

  return c.json({ ok: true, from, to });
});

app.get('/projects/:slug/issues/:id/comments', async (c) => {
  const slug = c.req.param('slug');
  const id = c.req.param('id');
  const source = await getSourceForSlug(slug);
  if (source == null) return c.json({ error: 'project not found' }, 404);
  const cfg = await getProject(slug);
  const repoRef = cfg?.source.kind === 'github' ? cfg.source.repo : slug;
  const workItemId = `github:${repoRef}#${id}`;
  const comments = await source.listComments(workItemId);
  return c.json({ comments });
});

app.post('/projects/:slug/issues/:id/comment', async (c) => {
  const slug = c.req.param('slug');
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { body?: string };
  if (!body.body?.trim()) return c.json({ error: 'body is required' }, 400);
  const source = await getSourceForSlug(slug);
  if (source == null) return c.json({ error: 'project not found' }, 404);
  const cfg = await getProject(slug);
  const repoRef = cfg?.source.kind === 'github' ? cfg.source.repo : slug;
  const workItemId = `github:${repoRef}#${id}`;
  await source.comment(workItemId, body.body.trim());
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'manual.action',
    payload: { action: 'comment', preview: body.body.trim().slice(0, 80) },
  });
  return c.json({ ok: true });
});

app.post('/projects/:slug/issues/:id/set-milestone', async (c) => {
  const slug = c.req.param('slug');
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { milestoneNumber?: number | null };
  const source = await getSourceForSlug(slug);
  if (source == null) return c.json({ error: 'project not found' }, 404);
  const cfg = await getProject(slug);
  const repoRef = cfg?.source.kind === 'github' ? cfg.source.repo : slug;
  const workItemId = `github:${repoRef}#${id}`;
  await source.setMilestone(workItemId, body.milestoneNumber ?? null);
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'manual.action',
    payload: { action: 'set-milestone', milestoneNumber: body.milestoneNumber ?? null },
  });
  bustCache(`issues:${slug}`);
  return c.json({ ok: true });
});

app.post('/projects/:slug/issues/:id/set-label', async (c) => {
  const slug = c.req.param('slug');
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { group?: string; value?: string };
  const validPriority = ['low', 'medium', 'high', 'critical'];
  // Note: schedule values here are the UI labels (current/backlog/icebox). The parser in
  // github-labels.ts maps to the internal Schedule type (current/next/later/blocked-by).
  // backlog→next, icebox→later when read back. This is intentional per issue #55 spec.
  const validSchedule = ['current', 'backlog', 'icebox'];
  if (body.group === 'priority' && !validPriority.includes(body.value ?? '')) {
    return c.json({ error: 'invalid priority' }, 400);
  }
  if (body.group === 'schedule' && !validSchedule.includes(body.value ?? '')) {
    return c.json({ error: 'invalid schedule' }, 400);
  }
  if (body.group !== 'priority' && body.group !== 'schedule') {
    return c.json({ error: 'group must be priority or schedule' }, 400);
  }
  const source = await getSourceForSlug(slug);
  if (source == null) return c.json({ error: 'project not found' }, 404);
  const cfg = await getProject(slug);
  const repoRef = cfg?.source.kind === 'github' ? cfg.source.repo : slug;
  const workItemId = `github:${repoRef}#${id}`;
  await source.setLabelInGroup(workItemId, body.group, body.value ?? '');
  eventStore.appendEvent({
    projectId: slug,
    workItemId,
    kind: 'manual.action',
    payload: { action: `set-${body.group}`, value: body.value },
  });
  bustCache(`issues:${slug}`);
  return c.json({ ok: true });
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

app.post('/inbox', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    body?: string;
    type?: string;
  };
  if (!body.title?.trim()) return c.json({ error: 'title is required' }, 400);
  const validTypes = ['feature', 'bug', 'chore', 'research'];
  const type = validTypes.includes(body.type ?? '') ? (body.type as string) : 'feature';
  const { db } = await import('@goose-hub/core/db/db.js');
  const { inboxItems } = await import('@goose-hub/core/db/schema.js');
  const [item] = await db
    .insert(inboxItems)
    .values({
      title: body.title.trim(),
      body: body.body ?? '',
      type,
    })
    .returning();
  return c.json({ item }, 201);
});

app.post('/projects/:slug/issues/:id/fake-run', async (c) => {
  const slug = c.req.param('slug');
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { skill?: string };
  const skill = body.skill === 'investigate' ? 'investigate' : 'triage';

  const source = await getSourceForSlug(slug);
  if (source == null) return c.json({ error: 'project not found' }, 404);

  const projectId = slug;
  const cfg = await getProject(slug);
  const repoRef = cfg?.source.kind === 'github' ? cfg.source.repo : slug;
  const workItemId = `github:${repoRef}#${id}`;

  // Fire-and-forget: emit events with delays
  (async () => {
    eventStore.appendEvent({ projectId, workItemId, kind: 'agent.spawned', payload: { skill } });
    await new Promise((r) => setTimeout(r, 1500));
    eventStore.appendEvent({
      projectId,
      workItemId,
      kind: 'agent.decision-summary',
      payload: { summary: `Running ${skill} skill on issue #${id}` },
    });
    await new Promise((r) => setTimeout(r, 1500));
    eventStore.appendEvent({
      projectId,
      workItemId,
      kind: 'agent.terminated',
      payload: { skill, status: 'completed' },
    });
  })();

  return c.json({ ok: true, skill });
});

if (process.env.VITEST == null) {
  const port = Number(process.env.PORT ?? 3001);
  serve({ fetch: app.fetch, port });
  console.log(`apps/server listening on http://localhost:${port}`);
}

export { app };
