import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { type DecisionKind, isDecisionKind } from '../../agent-runtime/decision-types.js';
import { db } from '../../db/db.js';
import { agentDecisions } from '../../db/schema.js';

export interface RecordDecisionParams {
  runId: string;
  kind: string;
  what: string;
  why: string;
  /** Current iteration within the run. Defaults to 0. */
  iteration?: number;
  /** Current phase label (e.g. 'plan', 'implement'). Defaults to ''. */
  phase?: string;
}

export type RecordDecisionResult =
  | { recorded: true; id: string }
  | { recorded: false; id: string; reason: 'duplicate' };

/**
 * Synchronously records a structured decision to the agent_decisions SQLite table.
 * Unknown `kind` values are coerced to 'UNKNOWN' (ADR 0018).
 * Deduplication: (runId, kind, what) — a second call with the same triple no-ops.
 * Callers must check `experimental.recordDecisionTool` before calling.
 */
export function recordDecision(params: RecordDecisionParams): RecordDecisionResult {
  const { runId, what, why, iteration = 0, phase = '' } = params;

  const kind: DecisionKind = isDecisionKind(params.kind) ? params.kind : 'UNKNOWN';

  const id = randomUUID();

  const result = db
    .insert(agentDecisions)
    .values({ id, runId, iteration, phase, kind, what, why })
    .onConflictDoNothing()
    .run();

  if (result.changes > 0) {
    return { recorded: true, id };
  }

  // Row already existed — look up its id for the caller.
  const existing = db
    .select({ id: agentDecisions.id })
    .from(agentDecisions)
    .where(
      and(
        eq(agentDecisions.runId, runId),
        eq(agentDecisions.kind, kind),
        eq(agentDecisions.what, what),
      ),
    )
    .get();

  return { recorded: false, id: existing?.id ?? id, reason: 'duplicate' };
}

/**
 * Reads all decision records for a run from agent_decisions in insertion order.
 * Used by reconciliation at run end when the feature flag is on.
 */
export function readRunDecisions(
  runId: string,
): Array<{ kind: DecisionKind; summary: string; evidence?: string }> {
  const rows = db
    .select({
      kind: agentDecisions.kind,
      what: agentDecisions.what,
      why: agentDecisions.why,
    })
    .from(agentDecisions)
    .where(eq(agentDecisions.runId, runId))
    .orderBy(agentDecisions.ts)
    .all();

  return rows.map((r) => ({
    kind: isDecisionKind(r.kind) ? r.kind : 'UNKNOWN',
    summary: r.what,
    evidence: r.why || undefined,
  }));
}
