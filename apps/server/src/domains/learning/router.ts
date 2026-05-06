import { minePatterns } from '@goose-hub/core/learning/mine.js';
import { Hono } from 'hono';
import { getProject } from '#shared/projects.js';

const router = new Hono();

/** Trigger cross-run pattern mining for a project. */
router.post('/:slug/learning/mine', async (c) => {
  const slug = c.req.param('slug');
  const cfg = await getProject(slug);
  if (cfg == null) return c.json({ error: 'project not found' }, 404);

  try {
    minePatterns({ projectId: slug });
    return c.json({ ok: true, message: 'Pattern mining completed' });
  } catch (err) {
    return c.json(
      { error: `Mining failed: ${err instanceof Error ? err.message : String(err)}` },
      500,
    );
  }
});

export { router as learningRouter };
