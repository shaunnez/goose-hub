import { Hono } from 'hono';
import { parseBody } from '../../shared/middleware.js';
import {
  approveIssue,
  commentOnIssue,
  fakeRun,
  getIssue,
  getIssueComments,
  getIssueEvents,
  getIssueTriage,
  getIssueWorktreeDiff,
  listIssues,
  overrideIssueRepo,
  rejectIssue,
  setIssueLabel,
  setIssueMilestone,
  transitionIssue,
} from './service.js';

const router = new Hono();

router.get('/:slug/issues', async (c) => {
  const result = await listIssues(c.req.param('slug'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/issues/:id', async (c) => {
  const result = await getIssue(c.req.param('slug'), c.req.param('id'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/issues/:id/events', async (c) => {
  const result = await getIssueEvents(c.req.param('slug'), c.req.param('id'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/issues/:id/comments', async (c) => {
  const result = await getIssueComments(c.req.param('slug'), c.req.param('id'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/issues/:id/triage', async (c) => {
  const result = await getIssueTriage(c.req.param('slug'), c.req.param('id'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

// Live diff for the Code tab (#185). Polled by the UI every 5 s.
router.get('/:slug/issues/:id/diff', async (c) => {
  const result = await getIssueWorktreeDiff(c.req.param('slug'), c.req.param('id'));
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404);
});

router.post('/:slug/issues/:id/transition', async (c) => {
  const body = await parseBody<{ from?: string; to?: string }>(c);
  if (!body.ok) return body.error;
  const result = await transitionIssue(
    c.req.param('slug'),
    c.req.param('id'),
    body.data.from,
    body.data.to,
  );
  if (!result.ok) {
    const errResult = result as {
      ok: false;
      error: string;
      status: number;
      legalTargets?: unknown[];
    };
    return c.json(
      {
        error: errResult.error,
        ...(errResult.legalTargets ? { legalTargets: errResult.legalTargets } : {}),
      },
      errResult.status as 400 | 404 | 422,
    );
  }
  return c.json(result.data);
});

router.post('/:slug/issues/:id/comment', async (c) => {
  const body = await parseBody<{ body?: string }>(c);
  if (!body.ok) return body.error;
  const result = await commentOnIssue(c.req.param('slug'), c.req.param('id'), body.data.body);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404);
});

router.post('/:slug/issues/:id/set-milestone', async (c) => {
  const body = await parseBody<{ milestoneNumber?: number | null }>(c);
  if (!body.ok) return body.error;
  const result = await setIssueMilestone(
    c.req.param('slug'),
    c.req.param('id'),
    body.data.milestoneNumber ?? null,
  );
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.post('/:slug/issues/:id/set-label', async (c) => {
  const body = await parseBody<{ group?: string; value?: string }>(c);
  if (!body.ok) return body.error;
  const result = await setIssueLabel(
    c.req.param('slug'),
    c.req.param('id'),
    body.data.group,
    body.data.value,
  );
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404);
});

router.post('/:slug/issues/:id/repo-override', async (c) => {
  const rawBody = (await c.req.json().catch(() => null)) as { repo?: unknown } | null;
  const repo = typeof rawBody?.repo === 'string' ? rawBody.repo : null;
  const result = await overrideIssueRepo(c.req.param('slug'), c.req.param('id'), repo);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404);
});

// Approval gate (#186) — UI-only routes, no agent caller.
router.post('/:slug/issues/:id/approve', async (c) => {
  const result = await approveIssue(c.req.param('slug'), c.req.param('id'));
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404 | 500);
});

router.post('/:slug/issues/:id/reject', async (c) => {
  const body = await parseBody<{ reason?: string }>(c);
  if (!body.ok) return body.error;
  const result = await rejectIssue(c.req.param('slug'), c.req.param('id'), body.data.reason);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404);
});

router.post('/:slug/issues/:id/fake-run', async (c) => {
  const body = await parseBody<{ skill?: string }>(c);
  if (!body.ok) return body.error;
  const result = await fakeRun(c.req.param('slug'), c.req.param('id'), body.data.skill ?? '');
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

export { router as issuesRouter };
