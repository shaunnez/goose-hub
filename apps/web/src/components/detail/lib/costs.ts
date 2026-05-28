import { fetchIssueCosts } from '@/lib/api';
import type { CostRowDto, WorkItemCostsDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

export type StageBreakdown = {
  stage: CostRowDto['stage'];
  usd: number;
  tokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  cacheHitRatio: number;
  label: 'estimated' | 'exact';
  runCount: number;
};

export interface IssueCostsBreakdown {
  byRun: Map<string, CostRowDto>;
  byStage: Map<CostRowDto['stage'], StageBreakdown>;
  total: number;
  totalTokens: number;
  totalInputTokens: number;
  totalCachedInputTokens: number;
  totalReasoningOutputTokens: number;
  totalCacheHitRatio: number;
  hasEstimated: boolean;
  totalLabel: 'estimated' | 'exact';
  runCount: number;
  isLoading: boolean;
}

const EMPTY: Omit<IssueCostsBreakdown, 'isLoading'> = {
  byRun: new Map(),
  byStage: new Map(),
  total: 0,
  totalTokens: 0,
  totalInputTokens: 0,
  totalCachedInputTokens: 0,
  totalReasoningOutputTokens: 0,
  totalCacheHitRatio: 0,
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
    let totalTokens = 0;
    let totalInputTokens = 0;
    let totalCachedInputTokens = 0;
    let totalReasoningOutputTokens = 0;

    for (const row of data.rows) {
      byRun.set(row.runId, row);
      const tokens = row.inputTokens + row.outputTokens;
      totalTokens += tokens;
      totalInputTokens += row.inputTokens;
      totalCachedInputTokens += row.cachedInputTokens;
      totalReasoningOutputTokens += row.reasoningOutputTokens;

      const existing = byStage.get(row.stage);
      if (existing) {
        existing.usd += row.costUsd;
        existing.tokens += tokens;
        existing.inputTokens += row.inputTokens;
        existing.cachedInputTokens += row.cachedInputTokens;
        existing.reasoningOutputTokens += row.reasoningOutputTokens;
        existing.cacheHitRatio = existing.cachedInputTokens / Math.max(existing.inputTokens, 1);
        existing.runCount += 1;
        if (row.costLabel === 'estimated') existing.label = 'estimated';
      } else {
        byStage.set(row.stage, {
          stage: row.stage,
          usd: row.costUsd,
          tokens,
          inputTokens: row.inputTokens,
          cachedInputTokens: row.cachedInputTokens,
          reasoningOutputTokens: row.reasoningOutputTokens,
          cacheHitRatio: row.cacheHitRatio,
          label: row.costLabel,
          runCount: 1,
        });
      }
    }

    return {
      byRun,
      byStage,
      total: data.totalUsd,
      totalTokens,
      totalInputTokens,
      totalCachedInputTokens,
      totalReasoningOutputTokens,
      totalCacheHitRatio: totalCachedInputTokens / Math.max(totalInputTokens, 1),
      hasEstimated: data.hasEstimated,
      totalLabel: data.hasEstimated ? 'estimated' : 'exact',
      runCount: data.rows.length,
      isLoading,
    };
  }, [data, isLoading, enabled]);
}
