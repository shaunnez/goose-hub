import { fetchIssueCosts } from '@/lib/api';
import type { CostRowDto, WorkItemCostsDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

export type StageBreakdown = {
  stage: CostRowDto['stage'];
  usd: number;
  tokens: number;
  label: 'estimated' | 'exact';
  runCount: number;
};

export interface IssueCostsBreakdown {
  byRun: Map<string, CostRowDto>;
  byStage: Map<CostRowDto['stage'], StageBreakdown>;
  bySkill: Map<string, StageBreakdown>;
  total: number;
  totalTokens: number;
  hasEstimated: boolean;
  totalLabel: 'estimated' | 'exact';
  runCount: number;
  isLoading: boolean;
}

const EMPTY: Omit<IssueCostsBreakdown, 'isLoading'> = {
  byRun: new Map(),
  byStage: new Map(),
  bySkill: new Map(),
  total: 0,
  totalTokens: 0,
  hasEstimated: false,
  totalLabel: 'exact',
  runCount: 0,
};

/**
 * One cached fetch per work item (`['issue-costs', slug, id]`) sliced by run
 * and by stage so timeline cards, overview, and stage sections can all read
 * from the same query. Disabled when `id` is empty so callers can compose
 * with not-yet-loaded work items without firing a 404.
 */
export function useIssueCostsBreakdown(projectSlug: string, id: string): IssueCostsBreakdown {
  const enabled = id !== '';
  const { data, isLoading } = useQuery<WorkItemCostsDto>({
    queryKey: ['issue-costs', projectSlug, id],
    queryFn: () => fetchIssueCosts(projectSlug, id),
    enabled,
  });

  return useMemo<IssueCostsBreakdown>(() => {
    if (data == null) return { ...EMPTY, isLoading: enabled && isLoading };

    const byRun = new Map<string, CostRowDto>();
    const byStage = new Map<CostRowDto['stage'], StageBreakdown>();
    const bySkill = new Map<string, StageBreakdown>();
    let totalTokens = 0;

    for (const row of data.rows) {
      byRun.set(row.runId, row);
      const tokens = row.inputTokens + row.outputTokens;
      totalTokens += tokens;

      accumulateBreakdown(byStage, row.stage, row, tokens);
      accumulateBreakdown(bySkill, row.skill, row, tokens);
    }

    return {
      byRun,
      byStage,
      bySkill,
      total: data.totalUsd,
      totalTokens,
      hasEstimated: data.hasEstimated,
      totalLabel: data.hasEstimated ? 'estimated' : 'exact',
      runCount: data.rows.length,
      isLoading,
    };
  }, [data, isLoading, enabled]);
}

function accumulateBreakdown(
  bucket: Map<string, StageBreakdown>,
  key: string,
  row: CostRowDto,
  tokens: number,
): void {
  const existing = bucket.get(key);
  if (existing) {
    existing.usd += row.costUsd;
    existing.tokens += tokens;
    existing.runCount += 1;
    if (row.costLabel === 'estimated') existing.label = 'estimated';
    return;
  }

  bucket.set(key, {
    stage: row.stage,
    usd: row.costUsd,
    tokens,
    label: row.costLabel,
    runCount: 1,
  });
}
