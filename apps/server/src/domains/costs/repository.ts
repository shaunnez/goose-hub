import {
  type CostRow,
  type WorkItemToolStatsRow,
  listCostsForProjectSince as coreListCostsForProjectSince,
  listCostsForWorkItem as coreListCostsForWorkItem,
  listToolStatsForWorkItem as coreListToolStatsForWorkItem,
  totalsByStageForProjectSince as coreTotalsByStage,
  totalsForProjectSince as coreTotalsForProject,
} from '@goose-hub/core/cost/repository.js';

export type {
  CostRow,
  ProjectTotals,
  StageTotal,
  WorkItemToolStatsRow,
} from '@goose-hub/core/cost/repository.js';

export function listCostsForWorkItem(workItemId: string): CostRow[] {
  return coreListCostsForWorkItem(workItemId);
}

export function listToolStatsForWorkItem(workItemId: string): WorkItemToolStatsRow[] {
  return coreListToolStatsForWorkItem(workItemId);
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
