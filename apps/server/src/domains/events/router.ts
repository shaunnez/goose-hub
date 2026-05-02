import { buildSseStream } from '@goose-hub/core/event-stream/sse.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { Hono } from 'hono';

const router = new Hono();

interface ToolCallHookPayload {
  tool_name?: string;
  run_id?: string;
  input_summary?: unknown;
  // Other fields may be present; we redact via secret-redaction in appendEvent.
  [key: string]: unknown;
}

/**
 * Tool-call audit endpoint (#209). The pre-tool-use-hook posts here on every
 * tool invocation. Records the event via eventStore.appendEvent (which applies
 * secret redaction) so the agent.tool-call audit trail is durable.
 */
router.post('/tool-call', async (c) => {
  let body: ToolCallHookPayload;
  try {
    body = (await c.req.json()) as ToolCallHookPayload;
  } catch {
    return c.json({ ok: false, error: 'invalid JSON' }, 400);
  }

  const runId = typeof body.run_id === 'string' ? body.run_id : null;
  eventStore.appendEvent({
    projectId: 'unknown',
    workItemId: null,
    kind: 'agent.tool-call',
    payload: body,
    runId,
  });

  return c.json({ ok: true }, 202);
});

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
