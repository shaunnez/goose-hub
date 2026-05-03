import { describe, expect, it, vi } from 'vitest';

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi.fn().mockReturnValue({ id: 1 }),
    replay: vi.fn().mockReturnValue([]),
  },
}));

import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { parseSseFilter, recordToolCall } from './service.js';

describe('parseSseFilter (#208)', () => {
  it('passes through projectId and workItemId from input', () => {
    const result = parseSseFilter({ projectId: 'proj', workItemId: 'wi' });
    expect(result.filter).toEqual({ projectId: 'proj', workItemId: 'wi' });
  });

  it('parses Last-Event-ID header into sinceId', () => {
    const result = parseSseFilter({ lastEventIdHeader: '42' });
    expect(result.sinceId).toBe(42);
  });

  it('falls back to lastEventId query when header is absent', () => {
    const result = parseSseFilter({ lastEventIdQuery: '7' });
    expect(result.sinceId).toBe(7);
  });

  it('header precedence over query', () => {
    const result = parseSseFilter({ lastEventIdHeader: '99', lastEventIdQuery: '1' });
    expect(result.sinceId).toBe(99);
  });

  it('returns undefined sinceId when neither is provided', () => {
    expect(parseSseFilter({}).sinceId).toBeUndefined();
  });

  it('returns undefined sinceId for non-numeric values (no replay)', () => {
    expect(parseSseFilter({ lastEventIdHeader: 'not-a-number' }).sinceId).toBeUndefined();
  });
});

describe('recordToolCall (#208)', () => {
  it('appends an agent.tool-call event with the supplied runId', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    const result = recordToolCall({ tool_name: 'Read', run_id: 'run-1' });
    expect(result).toEqual({ ok: true });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect(arg.kind).toBe('agent.tool-call');
    expect(arg.runId).toBe('run-1');
  });

  it('uses null runId when run_id is missing', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    recordToolCall({ tool_name: 'Bash' });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect(arg.runId).toBeNull();
  });
});
