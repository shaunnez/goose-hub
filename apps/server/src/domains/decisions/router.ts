import { recordDecision } from '@goose-hub/core/tool-layer/tools/record-decision.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '#shared/middleware.js';

const router = new Hono();

const DecisionBodySchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1),
  kind: z.string().min(1),
  what: z.string().min(1),
  why: z.string().min(1),
  iteration: z.number().int().min(0).optional(),
  phase: z.string().optional(),
});

/**
 * POST /api/decisions — records a structured decision captured by the
 * decision-capture PostToolUse hook. Validates input, coerces unknown kinds
 * to UNKNOWN (via recordDecision), returns 200 or 400 on validation error.
 */
router.post('/', async (c) => {
  const body = await parseBody<Record<string, unknown>>(c);
  if (!body.ok) return body.error;

  const parsed = DecisionBodySchema.safeParse(body.data);
  if (!parsed.success) {
    return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);
  }

  const { runId, kind, what, why, iteration, phase } = parsed.data;

  // recordDecision coerces unrecognised kinds to UNKNOWN (ADR 0018).
  const result = recordDecision({ runId, kind, what, why, iteration, phase });

  return c.json({ ok: true, id: result.id, recorded: result.recorded }, 200);
});

export { router as decisionsRouter };
