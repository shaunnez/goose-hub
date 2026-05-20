import { logger } from '@goose-hub/core/logger.js';
import { Hono } from 'hono';
import { dispatchResolveConflict, dispatchResumeIssue } from '#shared/dispatch.js';
import { parseBody } from '#shared/middleware.js';
import {
  approveIssue,
  approvePRD,
  commentOnIssue,
  declinePRD,
  getIssue,
  getIssueArtifact,
  getIssueComments,
  getIssueEvents,
  getIssueLegalTargets,
  getIssueSpec,
  getIssueTriage,
  getIssueWorktreeDiff,
  listIssues,
  overrideIssueRepo,
  proceedToPrd,
  rejectIssue,
  rejectPRD,
  revisePRD,
  setIssueLabel,
  setIssueMilestone,
  transitionIssue,
} from './service.js';

const router = new Hono();

router.get('/:slug/issues', async (c) => {
  const all = c.req.query('all') === 'true';
  const result = all
    ? await listIssues(c.req.param('slug'), { all })
    : await listIssues(c.req.param('slug'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/issues/:id', async (c) => {
  const result = await getIssue(c.req.param('slug'), c.req.param('id'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/issues/:id/legal-targets', async (c) => {
  const result = await getIssueLegalTargets(c.req.param('slug'), c.req.param('id'));
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 404 | 500);
});

router.get('/:slug/issues/:id/events', async (c) => {
  const limitStr = c.req.query('limit');
  const beforeStr = c.req.query('before');
  const opts =
    limitStr != null
      ? { limit: Number(limitStr), before: beforeStr != null ? Number(beforeStr) : undefined }
      : undefined;
  const result = await getIssueEvents(c.req.param('slug'), c.req.param('id'), opts);
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

router.get('/:slug/issues/:id/spec', async (c) => {
  const result = await getIssueSpec(c.req.param('slug'), c.req.param('id'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/issues/:id/artifacts/:artifactKey', async (c) => {
  const result = await getIssueArtifact(
    c.req.param('slug'),
    c.req.param('id'),
    c.req.param('artifactKey'),
  );
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
  const slug = c.req.param('slug');
  const id = c.req.param('id');
  const mockMergePR =
    process.env.MOCK_SOURCE === 'true'
      ? () => Promise.resolve({ sha: 'mock-sha-merged', merged: true })
      : undefined;
  const result = await approveIssue(slug, id, { mergePRImpl: mockMergePR });
  if (!result.ok && result.error === 'merge-conflict' && process.env.MOCK_SOURCE !== 'true') {
    // Fire-and-forget: workflow runs out-of-band. UI polls and reflects the
    // state transition once the worker resolves or escalates.
    // In MOCK_SOURCE mode the E2E test drives dispatch explicitly so we skip
    // the auto-trigger here to avoid a race with the test's own /dispatch call.
    dispatchResolveConflict(slug, Number(id)).catch((err: unknown) => {
      logger.error('dispatchResolveConflict failed', { slug, id, error: String(err) });
    });
  }
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404 | 409 | 500);
});

router.post('/:slug/issues/:id/reject', async (c) => {
  const body = await parseBody<{ reason?: string }>(c);
  if (!body.ok) return body.error;
  const result = await rejectIssue(c.req.param('slug'), c.req.param('id'), body.data.reason);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404);
});

// PRD review actions (M13.08 + M13.12). Approve advances prd-review →
// decomposing. Revise re-runs write-prd with human concerns. Decline closes
// the work item. reject-prd is kept as a 410 tombstone pointing to the two
// replacement endpoints.
router.post('/:slug/issues/:id/approve-prd', async (c) => {
  const result = await approvePRD(c.req.param('slug'), c.req.param('id'));
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404 | 409);
});

router.post('/:slug/issues/:id/reject-prd', async (c) => {
  return c.json({ error: 'reject-prd is gone. Use /revise-prd or /decline-prd instead.' }, 410);
});

router.post('/:slug/issues/:id/revise-prd', async (c) => {
  const body = await parseBody<{ concerns?: string[] }>(c);
  if (!body.ok) return body.error;
  const concerns = Array.isArray(body.data.concerns) ? body.data.concerns : [];
  const result = await revisePRD(c.req.param('slug'), c.req.param('id'), concerns);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404 | 409);
});

router.post('/:slug/issues/:id/decline-prd', async (c) => {
  const result = await declinePRD(c.req.param('slug'), c.req.param('id'));
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404 | 409);
});

router.post('/:slug/issues/:id/proceed-to-prd', async (c) => {
  const result = await proceedToPrd(c.req.param('slug'), c.req.param('id'));
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 400 | 404 | 409);
});

router.post('/:slug/issues/:id/resume', async (c) => {
  const slug = c.req.param('slug');
  const id = c.req.param('id');
  const issueNumber = Number(id);
  if (Number.isNaN(issueNumber)) return c.json({ error: 'invalid issue id' }, 400);
  dispatchResumeIssue(slug, issueNumber).catch((err: unknown) => {
    logger.error('resume: dispatchResumeIssue failed', { slug, id, error: String(err) });
  });
  return c.json({ ok: true });
});

export { router as issuesRouter };
