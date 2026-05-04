import { buildSseStream } from '@goose-hub/core/event-stream/sse.js';
import { Hono } from 'hono';
import { parseBody } from '../../shared/middleware.js';
import { parseSseFilter, recordToolCall } from './service.js';

const router = new Hono();

/**
 * Tool-call audit endpoint (#209). Thin delegator to recordToolCall (#208).
 */
router.post('/tool-call', async (c) => {
  const body = await parseBody<Record<string, unknown>>(c);
  if (!body.ok) return body.error;
  return c.json(recordToolCall(body.data), 202);
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
