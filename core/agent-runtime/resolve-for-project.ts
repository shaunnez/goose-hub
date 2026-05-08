import {
  readProjectSettings,
  readProjectSkillSettings,
} from '../db/repositories/project-settings.js';
import {
  type ResolvedBudget,
  type SkillBudgetOverride,
  resolveBudgets,
  resolveEscalatedBudgets,
} from './budgets.js';

/**
 * resolveBudgets with DB overrides applied. Reads project_settings and
 * project_skill_settings for the given projectId and passes the results
 * to the pure resolveBudgets function.
 *
 * Use this in workflow code that has a projectId; use resolveBudgets directly
 * only when no projectId is available (e.g. CLI without a project context).
 */
export function resolveBudgetsForProject(
  skill: string,
  projectBudgets:
    | { perWorkflowMaxUsd?: number; skillBudgetOverrides?: Record<string, SkillBudgetOverride> }
    | undefined,
  projectId: string,
): ResolvedBudget {
  const skillRows = readProjectSkillSettings(projectId);
  const globalRow = readProjectSettings(projectId);
  return resolveBudgets(skill, projectBudgets, skillRows.get(skill), globalRow?.perWorkflowMaxUsd);
}

/**
 * resolveEscalatedBudgets with DB global cap applied.
 */
export function resolveEscalatedBudgetsForProject(
  skill: string,
  projectBudgets:
    | { perWorkflowMaxUsd?: number; skillBudgetOverrides?: Record<string, SkillBudgetOverride> }
    | undefined,
  projectId: string,
): ResolvedBudget | null {
  const globalRow = readProjectSettings(projectId);
  return resolveEscalatedBudgets(skill, projectBudgets, globalRow?.perWorkflowMaxUsd);
}
