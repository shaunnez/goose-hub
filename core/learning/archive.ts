import { eq, sum } from 'drizzle-orm';
import { db } from '../db/db.js';
import { agentRunCosts, archivedLifecycles } from '../db/schema.js';
import { eventStore } from '../event-stream/store.js';
import type { DecisionKind } from '../retrospective/schemas.js';

export interface ArchivedDecisionSummary {
  kind: DecisionKind;
  summary: string;
  evidence?: string;
  role: string;
  personaId: string;
}

function extractRole(personaId: string): string {
  const parts = personaId.split('/');
  return parts.length >= 2 ? (parts[parts.length - 2] ?? 'unknown') : 'unknown';
}

export interface ArchiveInput {
  projectId: string;
  workItemId: string;
}

export function archiveLifecycle(input: ArchiveInput): void {
  const { projectId, workItemId } = input;

  const itemEvents = eventStore.replay({ projectId, workItemId });

  const decisionSummaries: ArchivedDecisionSummary[] = itemEvents
    .filter((e) => e.kind === 'agent.decision-summary')
    .map((e) => {
      const p = e.payload as { kind?: string; summary?: string; evidence?: string };
      const personaId = e.personaId ?? '';
      return {
        kind: (p.kind ?? 'UNKNOWN') as DecisionKind,
        summary: p.summary ?? '',
        evidence: p.evidence,
        role: extractRole(personaId),
        personaId,
      };
    });

  const retroCompleted = itemEvents.filter((e) => e.kind === 'retrospective.completed');
  const lastRetro = retroCompleted[retroCompleted.length - 1];

  type RetroPayload = {
    output?: {
      learningEntries?: unknown[];
      personaQualityScores?: unknown[];
    };
  };

  const retroPayload = lastRetro?.payload as RetroPayload | undefined;
  const learningEntries = retroPayload?.output?.learningEntries ?? [];
  const qualityScores = retroPayload?.output?.personaQualityScores ?? [];

  const runIds = Array.from(
    new Set(
      itemEvents
        .map((e) => e.runId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );

  const costRows =
    runIds.length > 0
      ? db
          .select({ total: sum(agentRunCosts.costUsd) })
          .from(agentRunCosts)
          .where(eq(agentRunCosts.workItemId, workItemId))
          .all()
      : [];

  const costsUsd = Number(costRows[0]?.total ?? 0);

  db.insert(archivedLifecycles)
    .values({
      projectId,
      workItemId,
      closedAt: new Date().toISOString(),
      decisionSummaries: JSON.stringify(decisionSummaries),
      learningEntries: JSON.stringify(learningEntries),
      qualityScores: JSON.stringify(qualityScores),
      costsUsd,
      runIds: JSON.stringify(runIds),
    })
    .run();
}
