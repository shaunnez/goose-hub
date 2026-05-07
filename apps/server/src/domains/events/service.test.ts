import { describe, expect, it, vi } from 'vitest';

vi.mock('@goose-hub/core/event-stream/store.js', () => ({
  eventStore: {
    appendEvent: vi.fn().mockReturnValue({ id: 1 }),
    replay: vi.fn().mockReturnValue([]),
  },
}));

import { eventStore } from '@goose-hub/core/event-stream/store.js';
import {
  parseSseFilter,
  recordDecisionSummary,
  recordToolCall,
  recordToolResult,
} from './service.js';

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

describe('recordDecisionSummary', () => {
  it('appends an agent.decision-summary-live event with the supplied runId', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    const result = recordDecisionSummary({ run_id: 'run-99', summary: 'Chose approach A' });
    expect(result).toEqual({ ok: true });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect(arg.kind).toBe('agent.decision-summary-live');
    expect(arg.runId).toBe('run-99');
  });

  it('resolves projectId and workItemId from matching agent.run-started event', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        kind: 'agent.run-started',
        projectId: 'proj-abc',
        workItemId: 'wi-42',
        runId: 'run-x',
        payload: {},
        createdAt: new Date().toISOString(),
      },
    ]);
    recordDecisionSummary({ run_id: 'run-x', summary: 'Phase: PLAN' });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect(arg.projectId).toBe('proj-abc');
    expect(arg.workItemId).toBe('wi-42');
  });

  it('falls back to unknown projectId when no run-started event exists', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    vi.mocked(eventStore.replay).mockReturnValueOnce([]);
    recordDecisionSummary({ run_id: 'run-missing', summary: 'some decision' });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect(arg.projectId).toBe('unknown');
  });

  it('uses null runId when run_id is missing from payload', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    recordDecisionSummary({ summary: 'no run id' });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect(arg.runId).toBeNull();
  });

  it('preserves a recognised kind on the event payload (#466)', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    recordDecisionSummary({ run_id: 'run-1', kind: 'PLAN', summary: 'plan something' });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect((arg.payload as { kind: string }).kind).toBe('PLAN');
  });

  it('coerces an unrecognised kind to UNKNOWN rather than dropping the event (#466)', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    recordDecisionSummary({ run_id: 'run-2', kind: 'made-up', summary: 'still gets through' });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect((arg.payload as { kind: string }).kind).toBe('UNKNOWN');
  });

  it('coerces a missing kind to UNKNOWN (#466)', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    recordDecisionSummary({ run_id: 'run-3', summary: 'no kind at all' });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect((arg.payload as { kind: string }).kind).toBe('UNKNOWN');
  });
});

describe('recordToolResult', () => {
  it('appends an agent.tool-result event with the supplied runId', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    const result = recordToolResult({
      run_id: 'run-42',
      tool_name: 'Bash',
      error: 'exit code 1\nsome error',
    });
    expect(result).toEqual({ ok: true });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect(arg.kind).toBe('agent.tool-result');
    expect(arg.runId).toBe('run-42');
  });

  it('uses null runId when run_id is missing', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    recordToolResult({ tool_name: 'Bash', error: 'oops' });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect(arg.runId).toBeNull();
  });

  it('resolves projectId/workItemId from agent.run-started when runId matches', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    vi.mocked(eventStore.replay).mockReturnValueOnce([
      {
        id: 1,
        kind: 'agent.run-started',
        projectId: 'proj-abc',
        workItemId: 'wi-42',
        runId: 'run-x',
        payload: {},
        createdAt: new Date().toISOString(),
      },
    ]);
    recordToolResult({ run_id: 'run-x', tool_name: 'Bash', error: 'fail' });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect(arg.projectId).toBe('proj-abc');
    expect(arg.workItemId).toBe('wi-42');
  });

  it('falls back to projectId=unknown when no matching run-started event', () => {
    vi.mocked(eventStore.appendEvent).mockClear();
    vi.mocked(eventStore.replay).mockReturnValueOnce([]);
    recordToolResult({ run_id: 'run-missing', tool_name: 'Bash', error: 'fail' });
    const arg = vi.mocked(eventStore.appendEvent).mock.calls[0][0];
    expect(arg.projectId).toBe('unknown');
  });
});
