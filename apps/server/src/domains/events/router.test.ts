import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: { appendEvent: vi.fn().mockReturnValue({ id: 1 }) },
}));
vi.mock('@goose-hub/core/event-stream/sse.js', () => ({
  buildSseStream: vi.fn(),
}));

import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { eventsRouter } from './router.js';

describe('POST /events/tool-call (#209)', () => {
  it('appends an agent.tool-call event and returns 202', async () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    const app = new Hono().route('/events', eventsRouter);

    const res = await app.request('/events/tool-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool_name: 'Read',
        run_id: 'run-test-123',
        input_summary: ['file_path'],
      }),
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    expect(eventStore.appendEvent).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect(arg.kind).toBe('agent.tool-call');
    expect(arg.runId).toBe('run-test-123');
  });

  it('returns 400 for invalid JSON', async () => {
    const app = new Hono().route('/events', eventsRouter);
    const res = await app.request('/events/tool-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('persists payload even when run_id is missing (runId becomes null)', async () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    const app = new Hono().route('/events', eventsRouter);

    const res = await app.request('/events/tool-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_name: 'Bash' }),
    });

    expect(res.status).toBe(202);
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect(arg.runId).toBeNull();
  });
});
