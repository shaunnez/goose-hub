import { readRunDecisions } from '../tool-layer/tools/record-decision.js';
import { eventStore } from '../event-stream/store.js';
import type { DecisionSummary } from './interface.js';

/**
 * Reconciles and emits agent.decision-summary events after a skill's parsed output
 * is available. Implements the DB-preferred, schema-field fallback strategy:
 *
 * - When hook-captured rows exist for `runId` (experimental.recordDecisionTool was on
 *   and the decision-capture hook fired), those rows are authoritative. Schema-field
 *   summaries from parsed output are dropped to avoid double-emission.
 * - When no DB rows exist (flag off, hook failed, or holdout role excluded from hook),
 *   fall back to the schema-field summaries from the parsed skill output.
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
  const sourceForEmission = dbRows.length > 0 ? dbRows : parsedSummaries;

  for (const s of sourceForEmission) {
    eventStore.appendEvent({
      projectId,
      workItemId,
      runId,
      kind: 'agent.decision-summary',
      payload: { skill, ...s },
    });
  }
}
