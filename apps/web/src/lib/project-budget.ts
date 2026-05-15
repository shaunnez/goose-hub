import { fetchCostSummary } from '@/lib/api';
import type { CostSummaryDto } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';

export type ProjectBudgetStatus = Pick<
  CostSummaryDto,
  | 'projectId'
  | 'dailyTokensUsed'
  | 'dailyTokensLimit'
  | 'dailyCostUsd'
  | 'dailyBudgetExceeded'
  | 'resetsAtUtc'
  | 'lastExceededAt'
>;

export function toProjectBudgetStatus(summary: CostSummaryDto): ProjectBudgetStatus {
  return {
    projectId: summary.projectId,
    dailyTokensUsed: summary.dailyTokensUsed,
    dailyTokensLimit: summary.dailyTokensLimit,
    dailyCostUsd: summary.dailyCostUsd,
    dailyBudgetExceeded: summary.dailyBudgetExceeded,
    resetsAtUtc: summary.resetsAtUtc,
    lastExceededAt: summary.lastExceededAt,
  };
}

export function useProjectBudgetStatus(projectSlug: string) {
  return useQuery<ProjectBudgetStatus>({
    queryKey: ['project-budget-status', projectSlug],
    queryFn: async () => toProjectBudgetStatus(await fetchCostSummary(projectSlug)),
    enabled: projectSlug.length > 0,
    refetchInterval: 30_000,
  });
}
