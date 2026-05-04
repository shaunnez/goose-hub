import type { CostLabel, Stage } from '@goose-hub/core/cost/types.js';
import type { Result } from '../../shared/middleware.js';
import {
  type CostRow,
  listCostsForWorkItem,
  totalsByStageForProjectSince,
  totalsForProjectSince,
} from './repository.js';

export interface CostSummaryDto {
  projectId: string;
  windows: {
    week: { totalUsd: number; totalRuns: number; hasEstimated: boolean };
    month: { totalUsd: number; totalRuns: number; hasEstimated: boolean };
  };
  byStage: Array<{
    stage: Stage;
    totalUsd: number;
    totalRuns: number;
    hasEstimated: boolean;
  }>;
}

export interface CostRowDto {
  runId: string;
  workItemId: string | null;
  stage: Stage;
  skill: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costLabel: CostLabel;
  personaId: string | null;
  createdAt: string;
}

export interface WorkItemCostsDto {
  workItemId: string;
  totalUsd: number;
  hasEstimated: boolean;
  rows: CostRowDto[];
}

function isoDaysAgo(days: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

export async function getCostSummary(
  projectId: string,
  now: Date = new Date(),
): Promise<Result<CostSummaryDto>> {
  if (!projectId.trim()) {
    return { ok: false, error: 'projectId is required', status: 400 };
  }
  const weekSince = isoDaysAgo(7, now);
  const monthSince = isoDaysAgo(30, now);

  const week = totalsForProjectSince(projectId, weekSince);
  const month = totalsForProjectSince(projectId, monthSince);
  const byStage = totalsByStageForProjectSince(projectId, monthSince);

  return {
    ok: true,
    data: {
      projectId,
      windows: { week, month },
      byStage,
    },
  };
}

export async function getCostsForWorkItem(workItemId: string): Promise<Result<WorkItemCostsDto>> {
  if (!workItemId.trim()) {
    return { ok: false, error: 'workItemId is required', status: 400 };
  }
  const rows = listCostsForWorkItem(workItemId);
  const totalUsd = rows.reduce((s, r) => s + r.costUsd, 0);
  const hasEstimated = rows.some((r) => r.costLabel === 'estimated');
  return {
    ok: true,
    data: {
      workItemId,
      totalUsd,
      hasEstimated,
      rows: rows.map(toRowDto),
    },
  };
}

function toRowDto(r: CostRow): CostRowDto {
  return {
    runId: r.runId,
    workItemId: r.workItemId,
    stage: r.stage,
    skill: r.skill,
    modelId: r.modelId,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: r.costUsd,
    costLabel: r.costLabel,
    personaId: r.personaId,
    createdAt: r.createdAt,
  };
}
