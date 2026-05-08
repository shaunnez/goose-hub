import { Hono } from 'hono';
import { parseBody } from '#shared/middleware.js';
import {
  createMilestone,
  deleteMilestone,
  getActiveMilestone,
  getSprintReviewEligibility,
  listClosedMilestoneIssues,
  listMilestoneIssues,
  listMilestones,
  setActiveMilestone,
  triggerSprintReview,
  updateMilestone,
} from './service.js';

const router = new Hono();

router.get('/:slug/milestones', async (c) => {
  const result = await listMilestones(c.req.param('slug'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/milestones/:milestone/issues', async (c) => {
  const milestone = Number(c.req.param('milestone'));
  if (Number.isNaN(milestone)) return c.json({ error: 'invalid milestone number' }, 400);
  const result = await listMilestoneIssues(c.req.param('slug'), milestone);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/milestones/:milestone/closed-issues', async (c) => {
  const milestone = Number(c.req.param('milestone'));
  if (Number.isNaN(milestone)) return c.json({ error: 'invalid milestone number' }, 400);
  const result = await listClosedMilestoneIssues(c.req.param('slug'), milestone);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.get('/:slug/active-milestone', async (c) => {
  const result = await getActiveMilestone(c.req.param('slug'));
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.post('/:slug/active-milestone', async (c) => {
  const body = await parseBody<{ milestoneNumber?: number | null }>(c);
  if (!body.ok) return body.error;
  const result = await setActiveMilestone(c.req.param('slug'), body.data.milestoneNumber ?? null);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

router.post('/:slug/milestones/:title/sprint-review', async (c) => {
  const title = decodeURIComponent(c.req.param('title'));
  const result = await triggerSprintReview(c.req.param('slug'), title);
  if (!result.ok) {
    return c.json({ error: result.error }, result.status as 404 | 409 | 500);
  }
  return c.json(result.data);
});

router.post('/:slug/milestones', async (c) => {
  const body = await parseBody<{ title: string }>(c);
  if (!body.ok) return body.error;
  const result = await createMilestone(c.req.param('slug'), body.data.title);
  return result.ok
    ? c.json(result.data, 201)
    : c.json({ error: result.error }, result.status as 404 | 422);
});

router.patch('/:slug/milestones/:number', async (c) => {
  const number = Number(c.req.param('number'));
  if (Number.isNaN(number)) return c.json({ error: 'invalid milestone number' }, 400);
  const body = await parseBody<{ title?: string; state?: 'open' | 'closed' }>(c);
  if (!body.ok) return body.error;
  const result = await updateMilestone(c.req.param('slug'), number, body.data);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 404 | 422);
});

router.delete('/:slug/milestones/:number', async (c) => {
  const number = Number(c.req.param('number'));
  if (Number.isNaN(number)) return c.json({ error: 'invalid milestone number' }, 400);
  const result = await deleteMilestone(c.req.param('slug'), number);
  return result.ok
    ? c.json(result.data)
    : c.json({ error: result.error }, result.status as 404 | 409);
});

router.get('/:slug/milestones/:number/sprint-review-eligibility', async (c) => {
  const number = Number(c.req.param('number'));
  if (Number.isNaN(number)) return c.json({ error: 'invalid milestone number' }, 400);
  const result = await getSprintReviewEligibility(c.req.param('slug'), number);
  return result.ok ? c.json(result.data) : c.json({ error: result.error }, result.status as 404);
});

export { router as milestonesRouter };
