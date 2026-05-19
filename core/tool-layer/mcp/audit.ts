import { eventStore } from '../../event-stream/store.js';
import type { FactoryContext } from './context.js';
import type { PathPolicyReason } from './path-policy.js';

export type BlockedReason = PathPolicyReason | 'command_not_allowed' | 'timeout' | 'destructive';

export interface ToolCallAudit {
  tool: string;
  input: Record<string, unknown>;
  durationMs?: number;
  truncated?: boolean;
  status?: 'ok' | 'failed' | 'timed_out';
  exitCode?: number | null;
}

export interface BlockedToolCallAudit extends ToolCallAudit {
  blocked: true;
  reason: BlockedReason;
  message: string;
}

/**
 * Emits a structured `agent.tool-call` event for a successful or failed
 * (but allowed) tool invocation. Payload is redacted by `eventStore` before
 * persistence; callers should still avoid placing raw secrets in `input`.
 */
export function emitToolCall(ctx: FactoryContext, audit: ToolCallAudit): void {
  eventStore.appendEvent({
    projectId: ctx.projectId,
    workItemId: ctx.workItemId,
    runId: ctx.runId,
    kind: 'agent.tool-call',
    payload: { blocked: false, ...audit },
  });
}

/**
 * Emits a structured `agent.tool-call` event for a denied call. `reason`
 * carries the typed policy code so consumers (wrong-surface guard, retros)
 * can aggregate by failure class without parsing free text.
 */
export function emitBlockedToolCall(ctx: FactoryContext, audit: BlockedToolCallAudit): void {
  eventStore.appendEvent({
    projectId: ctx.projectId,
    workItemId: ctx.workItemId,
    runId: ctx.runId,
    kind: 'agent.tool-call',
    payload: audit,
  });
}
