import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi.fn().mockReturnValue({ id: 1 }),
    replay: vi.fn().mockReturnValue([]),
  },
}));
vi.mock('@goose-hub/core/event-stream/sse.js', () => ({
  buildSseStream: vi.fn(),
}));

import { buildSseStream } from '@goose-hub/core/event-stream/sse.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { eventsRouter } from './router.js';

describe('POST /events/tool-call (#209)', () => {
  beforeEach(() => {
    vi.mocked(eventStore.appendEvent).mockClear();
  });

  it('appends an agent.tool-call event and returns 202', async () => {
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

describe('GET /events', () => {
  beforeEach(() => {
    vi.mocked(buildSseStream).mockClear();
  });

  it('calls buildSseStream and returns a Response with text/event-stream content type', async () => {
    const fakeStream = new ReadableStream();
    vi.mocked(buildSseStream).mockReturnValue(fakeStream);

    const app = new Hono().route('/events', eventsRouter);
    const res = await app.request('/events', { method: 'GET' });

    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(res.headers.get('Connection')).toBe('keep-alive');
    expect(buildSseStream).toHaveBeenCalledWith(
      { projectId: undefined, workItemId: undefined },
      undefined,
    );
  });

  it('passes projectId and workItemId query params as filter to buildSseStream', async () => {
    vi.mocked(buildSseStream).mockReturnValue(new ReadableStream());

    const app = new Hono().route('/events', eventsRouter);
    await app.request('/events?projectId=my-project&workItemId=issue-42', { method: 'GET' });

    expect(buildSseStream).toHaveBeenCalledWith(
      { projectId: 'my-project', workItemId: 'issue-42' },
      undefined,
    );
  });

  it('parses Last-Event-ID header and passes sinceId to buildSseStream', async () => {
    vi.mocked(buildSseStream).mockReturnValue(new ReadableStream());

    const app = new Hono().route('/events', eventsRouter);
    await app.request('/events', {
      method: 'GET',
      headers: { 'Last-Event-ID': '99' },
    });

    expect(buildSseStream).toHaveBeenCalledWith(
      { projectId: undefined, workItemId: undefined },
      99,
    );
  });

  it('parses lastEventId query param and passes sinceId to buildSseStream', async () => {
    vi.mocked(buildSseStream).mockReturnValue(new ReadableStream());

    const app = new Hono().route('/events', eventsRouter);
    await app.request('/events?lastEventId=7', { method: 'GET' });

    expect(buildSseStream).toHaveBeenCalledWith({ projectId: undefined, workItemId: undefined }, 7);
  });

  it('header Last-Event-ID takes precedence over lastEventId query param', async () => {
    vi.mocked(buildSseStream).mockReturnValue(new ReadableStream());

    const app = new Hono().route('/events', eventsRouter);
    await app.request('/events?lastEventId=3', {
      method: 'GET',
      headers: { 'Last-Event-ID': '55' },
    });

    expect(buildSseStream).toHaveBeenCalledWith(
      { projectId: undefined, workItemId: undefined },
      55,
    );
  });

  it('treats non-numeric Last-Event-ID as undefined sinceId', async () => {
    vi.mocked(buildSseStream).mockReturnValue(new ReadableStream());

    const app = new Hono().route('/events', eventsRouter);
    await app.request('/events', {
      method: 'GET',
      headers: { 'Last-Event-ID': 'not-a-number' },
    });

    expect(buildSseStream).toHaveBeenCalledWith(
      { projectId: undefined, workItemId: undefined },
      undefined,
    );
  });
});
