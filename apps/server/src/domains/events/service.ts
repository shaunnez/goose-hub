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

interface VerifyCommandPayload {
  run_id?: string;
  ac?: string;
  command?: string;
  actual?: string;
  passed?: boolean;
  [key: string]: unknown;
}

export interface RecordVerifyCommandResult {
  ok: boolean;
}

/**
 * Records a live verify-command event emitted by QA as each AC verify
 * command runs (#469). Resolves projectId/workItemId from the agent.run-started
 * event so SSE filters on the detail page can match these events.
 */
export function recordVerifyCommand(payload: VerifyCommandPayload): RecordVerifyCommandResult {
  const runId = typeof payload.run_id === 'string' ? payload.run_id : null;
  let projectId = 'unknown';
  let workItemId: string | null = null;
  if (runId != null) {
    const startEvent = eventStore.replay({ runId }).find((e) => e.kind === 'agent.run-started');
    if (startEvent != null) {
      projectId = startEvent.projectId;
      workItemId = startEvent.workItemId;
    }
  }
  eventStore.appendEvent({
    projectId,
    workItemId,
    kind: 'agent.verify-command',
    payload,
    runId,
  });
  return { ok: true };
}

interface DecisionSummaryPayload {
  run_id?: string;
  summary?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface RecordDecisionSummaryResult {
  ok: boolean;
}

/**
 * Records an audit event from the pre-tool-use hook (#209). Extracted
 * from the route handler so the route remains a thin delegator.
 * Resolves projectId/workItemId from the matching agent.run-started event
 * so SSE filters on the detail page can match these tool-call events.
 */
export function recordToolCall(payload: ToolCallHookPayload): RecordToolCallResult {
  const runId = typeof payload.run_id === 'string' ? payload.run_id : null;
  let projectId = 'unknown';
  let workItemId: string | null = null;
  if (runId != null) {
    const startEvent = eventStore.replay({ runId }).find((e) => e.kind === 'agent.run-started');
    if (startEvent != null) {
      projectId = startEvent.projectId;
      workItemId = startEvent.workItemId;
    }
  }
  eventStore.appendEvent({
    projectId,
    workItemId,
    kind: 'agent.tool-call',
    payload,
    runId,
  });
  return { ok: true };
}

/**
 * Records a live decision-summary event from the PostToolUse hook (#465).
 * Emits agent.decision-summary-live — distinct from the canonical agent.decision-summary
 * harvested at end-of-run so retro can reconcile duplicates.
 */
export function recordDecisionSummary(
  payload: DecisionSummaryPayload,
): RecordDecisionSummaryResult {
  const runId = typeof payload.run_id === 'string' ? payload.run_id : null;
  let projectId = 'unknown';
  let workItemId: string | null = null;
  if (runId != null) {
    const startEvent = eventStore.replay({ runId }).find((e) => e.kind === 'agent.run-started');
    if (startEvent != null) {
      projectId = startEvent.projectId;
      workItemId = startEvent.workItemId;
    }
  }
  eventStore.appendEvent({
    projectId,
    workItemId,
    kind: 'agent.decision-summary-live',
    payload,
    runId,
  });
  return { ok: true };
}
