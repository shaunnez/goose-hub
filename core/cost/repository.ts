import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/db.js';
import { agentRunCosts } from '../db/schema.js';
import type { CostLabel, CostRecord, Stage } from './types.js';

export interface CostRow extends CostRecord {
  id: number;
  createdAt: string;
}

/**
 * Persists a cost record for an agent run. Idempotent on `runId` — duplicate
 * inserts are silently ignored so retry loops don't double-count.
 */
export function recordCost(record: CostRecord): void {
  db.insert(agentRunCosts)
    .values({
      runId: record.runId,
      projectId: record.projectId,
      workItemId: record.workItemId,
      stage: record.stage,
      skill: record.skill,
      modelId: record.modelId,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      costUsd: record.costUsd,
      costLabel: record.costLabel,
      personaId: record.personaId,
    })
    .onConflictDoNothing({ target: agentRunCosts.runId })
    .run();
}

export function listCostsForWorkItem(workItemId: string): CostRow[] {
  const rows = db
    .select()
    .from(agentRunCosts)
    .where(eq(agentRunCosts.workItemId, workItemId))
    .orderBy(asc(agentRunCosts.createdAt))
    .all();
  return rows.map(toRow);
}

export interface ProjectTotals {
  totalUsd: number;
  totalRuns: number;
  /** True when any contributing row was 'estimated'. UI uses this to qualify the figure. */
  hasEstimated: boolean;
}

export interface StageTotal extends ProjectTotals {
  stage: Stage;
}

export function totalsForProjectSince(projectId: string, sinceIso: string): ProjectTotals {
  const [row] = db
    .select({
      totalUsd: sql<number>`coalesce(sum(${agentRunCosts.costUsd}), 0)`,
      totalRuns: sql<number>`count(*)`,
      hasEstimated: sql<number>`max(case when ${agentRunCosts.costLabel} = 'estimated' then 1 else 0 end)`,
    })
    .from(agentRunCosts)
    .where(and(eq(agentRunCosts.projectId, projectId), gte(agentRunCosts.createdAt, sinceIso)))
    .all();
  return {
    totalUsd: row?.totalUsd ?? 0,
    totalRuns: row?.totalRuns ?? 0,
    hasEstimated: (row?.hasEstimated ?? 0) === 1,
  };
}

export function totalsByStageForProjectSince(projectId: string, sinceIso: string): StageTotal[] {
  const rows = db
    .select({
      stage: agentRunCosts.stage,
      totalUsd: sql<number>`coalesce(sum(${agentRunCosts.costUsd}), 0)`,
      totalRuns: sql<number>`count(*)`,
      hasEstimated: sql<number>`max(case when ${agentRunCosts.costLabel} = 'estimated' then 1 else 0 end)`,
    })
    .from(agentRunCosts)
    .where(and(eq(agentRunCosts.projectId, projectId), gte(agentRunCosts.createdAt, sinceIso)))
    .groupBy(agentRunCosts.stage)
    .orderBy(desc(sql`sum(${agentRunCosts.costUsd})`))
    .all();
  return rows.map((r) => ({
    stage: r.stage as Stage,
    totalUsd: r.totalUsd ?? 0,
    totalRuns: r.totalRuns ?? 0,
    hasEstimated: (r.hasEstimated ?? 0) === 1,
  }));
}

function toRow(r: typeof agentRunCosts.$inferSelect): CostRow {
  return {
    id: r.id,
    runId: r.runId,
    projectId: r.projectId,
    workItemId: r.workItemId,
    stage: r.stage as Stage,
    skill: r.skill,
    modelId: r.modelId,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: r.costUsd,
    costLabel: r.costLabel as CostLabel,
    personaId: r.personaId,
    createdAt: r.createdAt,
  };
}
