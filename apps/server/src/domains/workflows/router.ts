import { logger } from '@goose-hub/core/logger.js';
import { Hono } from 'hono';

const router = new Hono();

router.post('/:slug/tick', async (c) => {
  const slug = c.req.param('slug');
  const { runTriageBatch } = await import('./triage-batch.js');
  runTriageBatch(slug).catch((err: unknown) => {
    logger.error('triage-batch failed', { slug, error: String(err) });
  });
  return c.json({ ok: true, slug }, 202);
});

router.post('/:slug/run-qa', async (c) => {
  const slug = c.req.param('slug');
  const { runQaBatch } = await import('./qa-batch.js');
  runQaBatch(slug).catch((err: unknown) => {
    logger.error('qa-batch failed', { slug, error: String(err) });
  });
  return c.json({ ok: true, slug }, 202);
});

router.post('/:slug/run-qa/:n', async (c) => {
  const slug = c.req.param('slug');
  const n = Number(c.req.param('n'));
  if (!Number.isFinite(n)) {
    return c.json({ ok: false, error: 'invalid issue number' }, 400);
  }
  const { dispatchQa } = await import('../../shared/dispatch.js');
  dispatchQa(slug, n).catch((err: unknown) => {
    logger.error('dispatchQa failed', { slug, n, error: String(err) });
  });
  return c.json({ ok: true, slug, issueNumber: n }, 202);
});

router.post('/:slug/run-review', async (c) => {
  const slug = c.req.param('slug');
  const { runReviewBatch } = await import('./review-batch.js');
  runReviewBatch(slug).catch((err: unknown) => {
    logger.error('review-batch failed', { slug, error: String(err) });
  });
  return c.json({ ok: true, slug }, 202);
});

router.post('/:slug/run-review/:n', async (c) => {
  const slug = c.req.param('slug');
  const n = Number(c.req.param('n'));
  if (!Number.isFinite(n)) {
    return c.json({ ok: false, error: 'invalid issue number' }, 400);
  }
  const { dispatchReview } = await import('../../shared/dispatch.js');
  dispatchReview(slug, n).catch((err: unknown) => {
    logger.error('dispatchReview failed', { slug, n, error: String(err) });
  });
  return c.json({ ok: true, slug, issueNumber: n }, 202);
});

router.post('/:slug/dispatch/:n', async (c) => {
  const slug = c.req.param('slug');
  const n = Number(c.req.param('n'));
  if (!Number.isFinite(n)) {
    return c.json({ ok: false, error: 'invalid issue number' }, 400);
  }
  const { dispatchForIssue } = await import('../../shared/dispatch.js');
  dispatchForIssue(slug, n).catch((err: unknown) => {
    logger.error('dispatchForIssue failed', { slug, n, error: String(err) });
  });
  return c.json({ ok: true, slug, issueNumber: n }, 202);
});

export { router as workflowsRouter };
