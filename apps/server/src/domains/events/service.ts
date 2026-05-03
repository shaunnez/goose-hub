import { eventStore } from '@goose-hub/core/event-stream/store.js';

export interface SseFilterInput {
  projectId?: string;
  workItemId?: string;
  lastEventIdHeader?: string;
  lastEventIdQuery?: string;
}

export interface SseFilterParsed {
  filter: { projectId?: string; workItemId?: string };
  sinceId: number | undefined;
}

/**
 * Extracts SSE filter parsing from the router (#208). Header takes
 * precedence over query for Last-Event-ID; non-numeric values resolve
 * to undefined (no replay) — the router previously contained this
 * logic inline.
 */
export function parseSseFilter(input: SseFilterInput): SseFilterParsed {
  const lastEventId = input.lastEventIdHeader ?? input.lastEventIdQuery;
  const parsed = lastEventId != null ? Number.parseInt(lastEventId, 10) : Number.NaN;
  return {
    filter: { projectId: input.projectId, workItemId: input.workItemId },
    sinceId: Number.isFinite(parsed) ? parsed : undefined,
  };
}

interface ToolCallHookPayload {
  tool_name?: string;
  run_id?: string;
  input_summary?: unknown;
  [key: string]: unknown;
}

export interface RecordToolCallResult {
  ok: boolean;
}

/**
 * Records an audit event from the pre-tool-use hook (#209). Extracted
 * from the route handler so the route remains a thin delegator.
 */
export function recordToolCall(payload: ToolCallHookPayload): RecordToolCallResult {
  const runId = typeof payload.run_id === 'string' ? payload.run_id : null;
  eventStore.appendEvent({
    projectId: 'unknown',
    workItemId: null,
    kind: 'agent.tool-call',
    payload,
    runId,
  });
  return { ok: true };
}
