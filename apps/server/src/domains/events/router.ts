import { buildSseStream } from '@goose-hub/core/event-stream/sse.js';
import { Hono } from 'hono';

const router = new Hono();

router.get('/', (c) => {
  const projectId = c.req.query('projectId') ?? undefined;
  const workItemId = c.req.query('workItemId') ?? undefined;
  const lastEventIdHeader = c.req.header('Last-Event-ID');
  const lastEventIdQuery = c.req.query('lastEventId');
  const lastEventId = lastEventIdHeader ?? lastEventIdQuery;
  const sinceId = lastEventId != null ? Number.parseInt(lastEventId, 10) : undefined;

  const stream = buildSseStream(
    { projectId, workItemId },
    Number.isNaN(sinceId) ? undefined : sinceId,
  );

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
