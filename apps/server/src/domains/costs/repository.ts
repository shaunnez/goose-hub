import {
  type CostRow,
  listCostsForProjectSince as coreListCostsForProjectSince,
  listCostsForWorkItem as coreListCostsForWorkItem,
  totalsByStageForProjectSince as coreTotalsByStage,
  totalsForProjectSince as coreTotalsForProject,
} from '@goose-hub/core/cost/repository.js';

export type { CostRow, ProjectTotals, StageTotal } from '@goose-hub/core/cost/repository.js';

export function listCostsForWorkItem(workItemId: string): CostRow[] {
  return coreListCostsForWorkItem(workItemId);
}

export function listCostsForProjectSince(projectId: string, sinceIso: string): CostRow[] {
  return coreListCostsForProjectSince(projectId, sinceIso);
}

export function totalsForProjectSince(projectId: string, sinceIso: string) {
  return coreTotalsForProject(projectId, sinceIso);
}

export function totalsByStageForProjectSince(projectId: string, sinceIso: string) {
  return coreTotalsByStage(projectId, sinceIso);
}
