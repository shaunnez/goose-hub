import { runSkillCoachingWorkflow } from '@goose-hub/core/workflows/skill-coaching.js';
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

export interface CoachSkillInput {
  targetSkillName: string;
  patternIds: string[];
  lifecycleIds?: string[];
}

export async function coachSkillService(
  projectId: string,
  input: CoachSkillInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await runSkillCoachingWorkflow({
      projectId,
      targetSkillName: input.targetSkillName,
      patternIds: input.patternIds,
      lifecycleIds: input.lifecycleIds,
    });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error dispatching coach workflow';
    return { ok: false, error };
  }
}
