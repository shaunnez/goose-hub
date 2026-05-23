import { eventStore } from '../../event-stream/store.js';
import {
  type ToolCallAuditPayload,
  normalizeToolCallAuditPayload,
  normalizeToolResultAuditPayload,
} from '../tool-call-audit.js';
import type { FactoryContext } from './context.js';
import type { PathPolicyReason } from './path-policy.js';

export type BlockedReason = PathPolicyReason | 'command_not_allowed' | 'timeout' | 'destructive';

export interface ToolCallAudit {
  tool: string;
  input: Record<string, unknown>;
  durationMs?: number;
  truncated?: boolean;
  bytesRead?: number;
  cached?: boolean;
  duplicateCount?: number;
  repo_intel_intent?: string;
  status?: 'ok' | 'failed' | 'timed_out';
  exitCode?: number | null;
  noMatches?: boolean;
  /**
   * Sorted list of keys present in the tool input. Used to debug shape
   * mismatches (e.g. agent called `repo_intel.query` without required args)
   * from the event stream without logging values, which keeps PII out and
   * keeps event payloads small.
   */
  inputKeys?: string[];
}

export interface BlockedToolCallAudit extends ToolCallAudit {
  blocked: true;
  reason: BlockedReason;
  message: string;
}

/**
 * Emits a structured `agent.tool-call` event for a successful or failed
 * (but allowed) tool invocation. Uses `normalizeToolCallAuditPayload` so
 * persisted events carry `raw_path` + `canonical_path` for path-bearing
 * tools, consistent with the rest of the system.
 */
export function emitToolCall(ctx: FactoryContext, audit: ToolCallAudit): void {
  const { input, ...rest } = audit;
  const raw: ToolCallAuditPayload = {
    ...rest,
    blocked: false,
    tool_name: audit.tool,
    tool_input: input,
    workspace_dir: ctx.workspaceRoot,
  };
  const normalized = normalizeToolCallAuditPayload(raw);
  eventStore.appendEvent({
    projectId: ctx.projectId,
    workItemId: ctx.workItemId,
    runId: ctx.runId,
    personaId: ctx.personaId ?? null,
    kind: 'agent.tool-call',
    payload: normalized,
  });
}

/**
 * Emits a structured `agent.tool-call` event for a denied call. `reason`
 * carries the typed policy code so consumers (wrong-surface guard, retros)
 * can aggregate by failure class without parsing free text.
 */
export function emitBlockedToolCall(ctx: FactoryContext, audit: BlockedToolCallAudit): void {
  const { input, ...rest } = audit;
  const raw: ToolCallAuditPayload = {
    ...rest,
    tool_name: audit.tool,
    tool_input: input,
    workspace_dir: ctx.workspaceRoot,
  };
  const normalized = normalizeToolResultAuditPayload(raw);
  eventStore.appendEvent({
    projectId: ctx.projectId,
    workItemId: ctx.workItemId,
    runId: ctx.runId,
    personaId: ctx.personaId ?? null,
    kind: 'agent.tool-call',
    payload: normalized,
  });
}
