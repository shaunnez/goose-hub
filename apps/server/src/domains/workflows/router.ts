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

router.post('/:slug/run-review', async (c) => {
  const slug = c.req.param('slug');
  const { runReviewBatch } = await import('./review-batch.js');
  runReviewBatch(slug).catch((err: unknown) => {
    logger.error('review-batch failed', { slug, error: String(err) });
  });
  return c.json({ ok: true, slug }, 202);
});

export { router as workflowsRouter };
