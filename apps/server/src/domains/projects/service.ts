import { listProjectConfigs, listProjects as readProjects } from '#shared/projects.js';

export async function listProjectsService(): Promise<{ projects: unknown[] }> {
  const projects = await readProjects();
  return { projects };
}

export interface ProjectConfigDto {
  slug: string;
  name: string;
  source: { kind: string; repo: string };
  activeMilestone: string | null;
  colorStripe: string;
  budgets: { perWorkflowMaxUsd: number; dailyTokens: number; perAdvisorMaxUsd: number };
  mode: string;
}

export async function listProjectConfigsService(): Promise<{ configs: ProjectConfigDto[] }> {
  const projects = await listProjectConfigs();
  const configs: ProjectConfigDto[] = projects.map((p) => ({
    slug: p.slug,
    name: p.name,
    source: p.source,
    activeMilestone: p.activeMilestone ?? null,
    colorStripe: p.colorStripe,
    budgets: {
      perWorkflowMaxUsd: p.budgets.perWorkflowMaxUsd,
      dailyTokens: p.budgets.dailyTokens,
      perAdvisorMaxUsd: p.budgets.perAdvisorMaxUsd,
    },
    mode: p.mode,
  }));
  return { configs };
}
