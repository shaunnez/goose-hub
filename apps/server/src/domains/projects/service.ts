import { listProjectConfigs, listProjects as readProjects } from '#shared/projects.js';

export async function listProjectsService(): Promise<{ projects: unknown[] }> {
  const projects = await readProjects();
  return { projects };
}

export interface ProjectConfigDto {
  slug: string;
  name: string;
  /**
   * `repo` carries `<owner>/<repo>` for github sources or the Jira project
   * key for jira sources. The DTO is intentionally flat so existing
   * consumers don't have to branch on `kind`.
   */
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
    source: {
      kind: p.source.kind,
      repo: p.source.kind === 'github' ? p.source.repo : p.source.projectKey,
    },
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
