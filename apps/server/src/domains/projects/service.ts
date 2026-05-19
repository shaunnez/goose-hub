import { listProjectConfigs, listProjects as readProjects } from '#shared/projects.js';

export async function listProjectsService(): Promise<{ projects: unknown[] }> {
  const projects = await readProjects();
  return { projects };
}

export interface ProjectConfigDto {
  slug: string;
  name: string;
  source: { kind: string; repo: string };
  targetRepo: { cloneUrl: string; defaultBranch: string; localPath: string };
  stack: {
    runtime: string;
    packageManager: string;
    testCommand: string;
    lintCommand?: string;
    typecheckCommand?: string;
    e2eCommand?: string;
  };
  activeMilestone: string | null;
  colorStripe: string;
  budgets: { perWorkflowMaxUsd: number; dailyTokens: number; perAdvisorMaxUsd: number };
  mode: string;
  storage: { path: string };
  isolation: { mode: string };
}

export async function listProjectConfigsService(): Promise<{ configs: ProjectConfigDto[] }> {
  const projects = await listProjectConfigs();
  const configs: ProjectConfigDto[] = projects.map((p) => ({
    slug: p.slug,
    name: p.name,
    source: p.source,
    targetRepo: {
      cloneUrl: p.targetRepo.cloneUrl,
      defaultBranch: p.targetRepo.defaultBranch,
      localPath: p.targetRepo.localPath,
    },
    stack: {
      runtime: p.stack.runtime,
      packageManager: p.stack.packageManager,
      testCommand: p.stack.testCommand,
      lintCommand: p.stack.lintCommand,
      typecheckCommand: p.stack.typecheckCommand,
      e2eCommand: p.stack.e2eCommand,
    },
    activeMilestone: p.activeMilestone ?? null,
    colorStripe: p.colorStripe,
    budgets: {
      perWorkflowMaxUsd: p.budgets.perWorkflowMaxUsd,
      dailyTokens: p.budgets.dailyTokens,
      perAdvisorMaxUsd: p.budgets.perAdvisorMaxUsd,
    },
    mode: p.mode,
    storage: { path: p.storage.path },
    isolation: { mode: p.isolation.mode },
  }));
  return { configs };
}
