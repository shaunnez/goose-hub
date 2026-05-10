import { readRunDecisions } from '../tool-layer/tools/record-decision.js';
import { eventStore } from '../event-stream/store.js';
import type { DecisionSummary } from './interface.js';

/**
 * Tracks DB decision row IDs already emitted in this process. Prevents
 * double-emission when the same runId spans multiple reconcile calls
 * (e.g. grill-and-prd.ts calls this three times with a shared runId).
 * Each new call emits only rows not yet in this set.
 */
const emittedDecisionIds = new Set<string>();

/** Clears the emitted-ID set. Call in test beforeEach to isolate tests. */
export function _clearEmittedIdsForTest(): void {
  emittedDecisionIds.clear();
}

/**
 * Reconciles and emits agent.decision-summary events after a skill's parsed output
 * is available. Implements the DB-preferred, schema-field fallback strategy:
 *
 * - When hook-captured rows exist for `runId` (experimental.recordDecisionTool was on
 *   and the decision-capture hook fired), those rows are authoritative. Schema-field
 *   summaries from parsed output are dropped to avoid double-emission.
 * - When no DB rows exist (flag off, hook failed, or holdout role excluded from hook),
 *   fall back to the schema-field summaries from the parsed skill output.
 * - Each DB row ID is tracked; rows already emitted by a prior call for the same runId
 *   are skipped, so multi-skill workflows sharing a runId do not duplicate events.
 *
 * Must be called in workflows post-parse, NOT in the runtime layer. The runtime has
 * no knowledge of per-skill decisionSummaries fields.
 *
 * @param runId           - Agent run ID (ULID/UUID) used as the DB key.
 * @param projectId       - Target project ID for event routing.
 * @param workItemId      - Work item ID for event routing.
 * @param skill           - Skill name, included in the event payload.
 * @param parsedSummaries - Decision summaries extracted from validated skill output.
 */
export function reconcileDecisionSummaries(
  runId: string,
  projectId: string,
  workItemId: string | null,
  skill: string,
  parsedSummaries: DecisionSummary[],
): void {
  const dbRows = readRunDecisions(runId);

  if (dbRows.length > 0) {
    // DB-preferred: emit only rows not yet emitted in a prior reconcile call.
    for (const r of dbRows) {
      if (emittedDecisionIds.has(r.id)) continue;
      emittedDecisionIds.add(r.id);
      eventStore.appendEvent({
        projectId,
        workItemId,
        runId,
        kind: 'agent.decision-summary',
        payload: { skill, kind: r.kind, summary: r.summary, ...(r.evidence ? { evidence: r.evidence } : {}) },
      });
    }
  } else {
    // Fallback: no DB rows → emit schema-field summaries from parsed output.
    for (const s of parsedSummaries) {
      eventStore.appendEvent({
        projectId,
        workItemId,
        runId,
        kind: 'agent.decision-summary',
        payload: { skill, ...s },
      });
    }
  }
}
