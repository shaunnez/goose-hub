import { isDecisionKind } from '@goose-hub/core/agent-runtime/decision-types.js';
import { db } from '@goose-hub/core/db/db.js';
import { agentRunCosts, archivedLifecycles } from '@goose-hub/core/db/schema.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type {
  DecisionSummary,
  LearningEntry,
  QualityScore,
} from '@goose-hub/core/retrospective/schemas.js';
import { eq } from 'drizzle-orm';

/**
 * Archives lifecycle data for a completed work item.
 * Extracts decision summaries, learning entries, quality scores, and costs from events,
 * and writes to archived_lifecycles table.
 */
export function archiveLifecycle({
  projectId,
  workItemId,
}: {
  projectId: string;
  workItemId: string;
}): void {
  // Fetch all events for this work item
  const events = eventStore.replay({ projectId, workItemId });

  // Extract decision summaries
  const decisionSummaries: DecisionSummary[] = [];
  const seenDecisions = new Set<string>();

  for (const event of events) {
    if (event.kind === 'agent.decision-summary') {
      const { kind, summary, evidence } = event.payload as {
        kind?: string;
        summary?: string;
        evidence?: string;
      };
      const validKind = isDecisionKind(kind) ? kind : 'UNKNOWN';
      const key = `${validKind}:${summary}`;
      if (!seenDecisions.has(key)) {
        decisionSummaries.push({
          kind: validKind,
          summary: summary ?? '',
          evidence,
        });
        seenDecisions.add(key);
      }
    }
  }

  // Extract learning entries (from retrospective events)
  const learningEntries: LearningEntry[] = [];
  for (const event of events) {
    if (event.kind === 'retrospective.completed') {
      const output = event.payload as { output?: { learningEntries?: LearningEntry[] } };
      if (output.output?.learningEntries) {
        learningEntries.push(...output.output.learningEntries);
      }
    }
  }

  // Extract quality scores (from retrospective events)
  const qualityScores: QualityScore[] = [];
  for (const event of events) {
    if (event.kind === 'retrospective.completed') {
      const output = event.payload as { output?: { personaQualityScores?: QualityScore[] } };
      if (output.output?.personaQualityScores) {
        qualityScores.push(...output.output.personaQualityScores);
      }
    }
  }

  // Extract costs from agentRunCosts table for this work item
  let totalCostsUsd = 0;
  const runIds: Set<string> = new Set();
  const costs = db
    .select()
    .from(agentRunCosts)
    .where(eq(agentRunCosts.workItemId, workItemId))
    .all();

  for (const cost of costs) {
    totalCostsUsd += cost.costUsd;
    if (cost.runId) {
      runIds.add(cost.runId);
    }
  }

  // Write to archived_lifecycles
  db.insert(archivedLifecycles)
    .values({
      projectId,
      workItemId,
      closedAt: new Date().toISOString(),
      decisionSummaries: JSON.stringify(decisionSummaries),
      learningEntries: JSON.stringify(learningEntries),
      qualityScores: JSON.stringify(qualityScores),
      costsUsd: totalCostsUsd,
      runIds: JSON.stringify(Array.from(runIds)),
    })
    .run();
}
