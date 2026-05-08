import {
  parseComplexityOverrides,
  readProjectModelSettingsForRole,
} from '../db/repositories/project-model-settings.js';
import {
  readProjectSettings,
  readProjectSkillSettings,
} from '../db/repositories/project-settings.js';
import type { AgentConfig, ModelTier, Role } from '../types.js';
import {
  type ResolvedBudget,
  type SkillBudgetOverride,
  resolveBudgets,
  resolveEscalatedBudgets,
} from './budgets.js';
import type { SkillConfig } from './interface.js';
import { type RoleModelResult, selectModelForRole } from './select-model-for-role.js';

/** Merged global settings: DB row wins over projectConfig value when non-null. */
export interface EffectiveGlobalSettings {
  perWorkflowMaxUsd?: number;
  maxParallelAgents?: number;
  dailyTokens?: number;
  maxRetries?: number;
  perAdvisorMaxUsd?: number;
}

/**
 * Returns effective global settings for a project, with DB overrides taking
 * precedence over projectConfig values. Call sites that previously read
 * `projectConfig.budgets.maxParallelAgents` (etc.) should use this instead.
 */
export function resolveGlobalSettingsForProject(
  projectId: string,
  projectBudgets?: {
    perWorkflowMaxUsd?: number;
    maxParallelAgents?: number;
    dailyTokens?: number;
    maxRetries?: number;
    perAdvisorMaxUsd?: number;
  },
): EffectiveGlobalSettings {
  const dbRow = readProjectSettings(projectId);
  return {
    perWorkflowMaxUsd: dbRow?.perWorkflowMaxUsd ?? projectBudgets?.perWorkflowMaxUsd,
    maxParallelAgents: dbRow?.maxParallelAgents ?? projectBudgets?.maxParallelAgents,
    dailyTokens: dbRow?.dailyTokens ?? projectBudgets?.dailyTokens,
    maxRetries: dbRow?.maxRetries ?? projectBudgets?.maxRetries,
    perAdvisorMaxUsd: dbRow?.perAdvisorMaxUsd ?? projectBudgets?.perAdvisorMaxUsd,
  };
}

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

/**
 * selectModelForRole with DB override applied. Reads project_model_settings for
 * the given projectId+role and passes the result to the pure selectModelForRole.
 *
 * Use this in workflow code that has a projectId; use selectModelForRole directly
 * only when no DB access is available.
 */
export function selectModelForRoleForProject(
  role: Role,
  projectId: string,
  agentConfig: Pick<AgentConfig, 'rolesModels' | 'allowHoldoutOverride'> | undefined,
  skillConfig: Pick<SkillConfig, 'modelPin'> | undefined,
): RoleModelResult {
  const dbRow = readProjectModelSettingsForRole(projectId, role);
  return selectModelForRole(role, agentConfig, skillConfig, dbRow ?? undefined);
}

/**
 * Returns the complexity overrides for a role from the DB, merged with any
 * project-config overrides. DB wins per key. Keys are "type:<T>",
 * "priority:<P>", or "default". Values are ModelTier strings.
 *
 * These are fed into selectModel() as the highest-priority override layer.
 */
export function resolveComplexityOverridesForProject(
  role: Role,
  projectId: string,
  configOverrides: Record<string, ModelTier> | undefined,
): Record<string, ModelTier> {
  const dbRow = readProjectModelSettingsForRole(projectId, role);
  const dbOverrides = dbRow ? parseComplexityOverrides(dbRow) : {};

  // Build the merged map: configOverrides as base, DB keys win over config keys
  const merged: Record<string, ModelTier> = {};
  if (configOverrides) {
    for (const [key, tier] of Object.entries(configOverrides)) {
      // Config keys are "role+type:T" / "role+priority:P" / "role" — strip role prefix
      const rolePrefix = `${role}+`;
      const bare = key.startsWith(rolePrefix)
        ? key.slice(rolePrefix.length)
        : key === role
          ? 'default'
          : null;
      if (bare != null) merged[bare] = tier;
    }
  }
  for (const [key, tier] of Object.entries(dbOverrides)) {
    merged[key] = tier;
  }
  return merged;
}
