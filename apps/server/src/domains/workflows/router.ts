import { minePatterns } from '@goose-hub/core/learning/mine.js';
import { logger } from '@goose-hub/core/logger.js';
import { Hono } from 'hono';
import { dispatchForIssue, dispatchQa, dispatchRetro, dispatchReview } from '#shared/dispatch.js';
import { runQaBatch } from './qa-batch.js';
import { runRetroBatch } from './retro-batch.js';
import { runReviewBatch } from './review-batch.js';
import { runTriageBatch } from './triage-batch.js';

const router = new Hono();

router.post('/:slug/tick', async (c) => {
  const slug = c.req.param('slug');
  runTriageBatch(slug).catch((err: unknown) => {
    logger.error('triage-batch failed', { slug, error: String(err) });
  });
  return c.json({ ok: true, slug }, 202);
});

router.post('/:slug/run-qa', async (c) => {
  const slug = c.req.param('slug');
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
  dispatchQa(slug, n).catch((err: unknown) => {
    logger.error('dispatchQa failed', { slug, n, error: String(err) });
  });
  return c.json({ ok: true, slug, issueNumber: n }, 202);
});

router.post('/:slug/run-review', async (c) => {
  const slug = c.req.param('slug');
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
  dispatchReview(slug, n).catch((err: unknown) => {
    logger.error('dispatchReview failed', { slug, n, error: String(err) });
  });
  return c.json({ ok: true, slug, issueNumber: n }, 202);
});

router.post('/:slug/run-retro', async (c) => {
  const slug = c.req.param('slug');
  runRetroBatch(slug).catch((err: unknown) => {
    logger.error('retro-batch failed', { slug, error: String(err) });
  });
  return c.json({ ok: true, slug }, 202);
});

router.post('/:slug/run-retro/:n', async (c) => {
  const slug = c.req.param('slug');
  const n = Number(c.req.param('n'));
  if (!Number.isFinite(n)) {
    return c.json({ ok: false, error: 'invalid issue number' }, 400);
  }
  dispatchRetro(slug, n).catch((err: unknown) => {
    logger.error('dispatchRetro failed', { slug, n, error: String(err) });
  });
  return c.json({ ok: true, slug, issueNumber: n }, 202);
});

router.post('/:slug/dispatch/:n', async (c) => {
  const slug = c.req.param('slug');
  const n = Number(c.req.param('n'));
  if (!Number.isFinite(n)) {
    return c.json({ ok: false, error: 'invalid issue number' }, 400);
  }
  dispatchForIssue(slug, n).catch((err: unknown) => {
    logger.error('dispatchForIssue failed', { slug, n, error: String(err) });
  });
  return c.json({ ok: true, slug, issueNumber: n }, 202);
});

router.post('/:slug/learning/mine', (c) => {
  const slug = c.req.param('slug');
  const since = c.req.query('since');
  try {
    minePatterns({ projectId: slug, since });
    return c.json({ ok: true, slug }, 200);
  } catch (err) {
    logger.error('minePatterns failed', { slug, error: String(err) });
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export { router as workflowsRouter };
