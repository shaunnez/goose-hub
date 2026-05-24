import { tryProviderOf } from '@goose-hub/core/agent-runtime/models.js';
import type { CostLabel, Stage } from '@goose-hub/core/cost/types.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import {
  type SymbolIndexLookupReport,
  buildSymbolIndexLookupReport,
} from '@goose-hub/core/symbol-index/report.js';
import type { Result } from '#shared/middleware.js';
import {
  type CostRow,
  type WorkItemToolStatsRow,
  listCostsForProjectSince,
  listCostsForWorkItem,
  listToolStatsForWorkItem,
  totalsByStageForProjectSince,
  totalsForProjectSince,
} from './repository.js';

export interface CostSummaryDto {
  projectId: string;
  dailyTokensUsed: number;
  dailyTokensLimit: number;
  dailyCostUsd: number;
  dailyBudgetExceeded: boolean;
  resetsAtUtc: string;
  lastExceededAt: string | null;
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
  byProvider: {
    claude: { totalUsd: number; totalRuns: number; hasEstimated: boolean };
    codex: { totalUsd: number; totalRuns: number; hasEstimated: boolean };
  };
  symbolIndex: SymbolIndexLookupReport;
}

export interface CostRowDto {
  runId: string;
  workItemId: string | null;
  stage: Stage;
  skill: string;
  modelId: string;
  provider: 'claude' | 'codex';
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costLabel: CostLabel;
  personaId: string | null;
  createdAt: string;
  readCount: number;
  grepCount: number;
  writeCount: number;
  editCount: number;
  bytesRead: number;
  uniquePathsRead: number;
  redundantReads: number;
}

export interface WorkItemCostsDto {
  workItemId: string;
  totalUsd: number;
  hasEstimated: boolean;
  rows: CostRowDto[];
}

export interface WorkItemToolStatsDto {
  workItemId: string;
  rows: CostRowDto[];
}

function isoDaysAgo(days: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function utcDayWindow(now: Date): { start: string; end: string } {
  const startMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const endMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  };
}

function toProviderTotals(rows: CostRow[]): {
  totalUsd: number;
  totalRuns: number;
  hasEstimated: boolean;
} {
  return {
    totalUsd: rows.reduce((s, r) => s + r.costUsd, 0),
    totalRuns: rows.length,
    hasEstimated: rows.some((r) => r.costLabel === 'estimated'),
  };
}

export async function getCostSummary(
  projectId: string,
  opts: { now?: Date; dailyTokensLimit?: number } = {},
): Promise<Result<CostSummaryDto>> {
  if (!projectId.trim()) {
    return { ok: false, error: 'projectId is required', status: 400 };
  }
  const now = opts.now ?? new Date();
  const dailyTokensLimit = opts.dailyTokensLimit ?? 0;
  const weekSince = isoDaysAgo(7, now);
  const monthSince = isoDaysAgo(30, now);
  const today = utcDayWindow(now);

  const week = totalsForProjectSince(projectId, weekSince);
  const month = totalsForProjectSince(projectId, monthSince);
  const byStage = totalsByStageForProjectSince(projectId, monthSince);

  const monthRows = listCostsForProjectSince(projectId, monthSince);
  const dailyRows = monthRows.filter((r) => r.createdAt >= today.start && r.createdAt < today.end);
  const dailyTokensUsed = dailyRows.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);
  const dailyCostUsd = dailyRows.reduce((s, r) => s + r.costUsd, 0);
  const lastBudgetExceeded = eventStore.replay({
    projectId,
    kind: 'project.budget-exceeded',
    limit: 1,
    order: 'desc',
  })[0];
  const claudeRows = monthRows.filter((r) => tryProviderOf(r.modelId) === 'claude');
  const codexRows = monthRows.filter((r) => tryProviderOf(r.modelId) === 'codex');
  const symbolIndex = buildSymbolIndexLookupReport(eventStore.replay({ projectId }));

  return {
    ok: true,
    data: {
      projectId,
      dailyTokensUsed,
      dailyTokensLimit,
      dailyCostUsd,
      dailyBudgetExceeded: dailyTokensLimit > 0 && dailyTokensUsed >= dailyTokensLimit,
      resetsAtUtc: today.end,
      lastExceededAt: lastBudgetExceeded?.createdAt ?? null,
      windows: { week, month },
      byStage,
      byProvider: {
        claude: toProviderTotals(claudeRows),
        codex: toProviderTotals(codexRows),
      },
      symbolIndex,
    },
  };
}

export async function getCostsForWorkItem(workItemId: string): Promise<Result<WorkItemCostsDto>> {
  if (!workItemId.trim()) {
    return { ok: false, error: 'workItemId is required', status: 400 };
  }
  const rows = listCostsForWorkItem(workItemId);
  const toolStatsByRun = new Map(
    listToolStatsForWorkItem(workItemId).map((row) => [row.runId, row]),
  );
  const totalUsd = rows.reduce((s, r) => s + r.costUsd, 0);
  const hasEstimated = rows.some((r) => r.costLabel === 'estimated');
  return {
    ok: true,
    data: {
      workItemId,
      totalUsd,
      hasEstimated,
      rows: rows.map((row) => toRowDto(row, toolStatsByRun.get(row.runId))),
    },
  };
}

export async function getToolStatsForWorkItem(
  workItemId: string,
): Promise<Result<WorkItemToolStatsDto>> {
  if (!workItemId.trim()) {
    return { ok: false, error: 'workItemId is required', status: 400 };
  }
  return {
    ok: true,
    data: {
      workItemId,
      rows: listToolStatsForWorkItem(workItemId).map((row) => toRowDto(row, row)),
    },
  };
}

function toRowDto(r: CostRow | WorkItemToolStatsRow, stats?: WorkItemToolStatsRow): CostRowDto {
  return {
    runId: r.runId,
    workItemId: r.workItemId,
    stage: r.stage,
    skill: r.skill,
    modelId: r.modelId,
    provider: tryProviderOf(r.modelId),
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: r.costUsd,
    costLabel: r.costLabel,
    personaId: r.personaId,
    createdAt: r.createdAt,
    readCount: stats?.readCount ?? 0,
    grepCount: stats?.grepCount ?? 0,
    writeCount: stats?.writeCount ?? 0,
    editCount: stats?.editCount ?? 0,
    bytesRead: stats?.bytesRead ?? 0,
    uniquePathsRead: stats?.uniquePathsRead ?? 0,
    redundantReads: stats?.redundantReads ?? 0,
  };
}
