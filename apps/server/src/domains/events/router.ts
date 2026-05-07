import { buildSseStream } from '@goose-hub/core/event-stream/sse.js';
import { Hono } from 'hono';
import { parseBody } from '#shared/middleware.js';
import {
  parseSseFilter,
  recordDecisionSummary,
  recordToolCall,
  recordToolResult,
  recordVerifyCommand,
} from './service.js';

const router = new Hono();

/**
 * Tool-call audit endpoint (#209). Thin delegator to recordToolCall (#208).
 */
router.post('/tool-call', async (c) => {
  const body = await parseBody<Record<string, unknown>>(c);
  if (!body.ok) return body.error;
  return c.json(recordToolCall(body.data), 202);
});

/**
 * Live decision-summary endpoint (#465). Thin delegator to recordDecisionSummary.
 * Called by the PostToolUse hook whenever a [decision] marker is found in the transcript.
 */
router.post('/decision-summary', async (c) => {
  const body = await parseBody<Record<string, unknown>>(c);
  if (!body.ok) return body.error;
  return c.json(recordDecisionSummary(body.data), 202);
});

/**
 * Tool-result error capture endpoint. Thin delegator to recordToolResult.
 * Called by the PostToolUse hook when a Bash tool call returns an error.
 */
router.post('/tool-result', async (c) => {
  const body = await parseBody<Record<string, unknown>>(c);
  if (!body.ok) return body.error;
  return c.json(recordToolResult(body.data), 202);
});

/**
 * Live verify-command endpoint (#469). Thin delegator to recordVerifyCommand.
 * Called after each per-AC verify command runs during QA.
 */
router.post('/verify-command', async (c) => {
  const body = await parseBody<Record<string, unknown>>(c);
  if (!body.ok) return body.error;
  return c.json(recordVerifyCommand(body.data), 202);
});

router.get('/', (c) => {
  const { filter, sinceId } = parseSseFilter({
    projectId: c.req.query('projectId') ?? undefined,
    workItemId: c.req.query('workItemId') ?? undefined,
    lastEventIdHeader: c.req.header('Last-Event-ID'),
    lastEventIdQuery: c.req.query('lastEventId'),
  });

  const stream = buildSseStream(filter, sinceId);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

export { router as eventsRouter };
