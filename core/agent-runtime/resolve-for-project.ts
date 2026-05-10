import {
  parseComplexityOverrides,
  readProjectModelSettingsForRole,
} from '../db/repositories/project-model-settings.js';
import {
  readProjectSettings,
  readProjectSkillSettings,
} from '../db/repositories/project-settings.js';
import type { ModelTier, Role } from '../types.js';
import {
  type ResolvedBudget,
  type SkillBudgetOverride,
  resolveBudgets,
  resolveEscalatedBudgets,
} from './budgets.js';

/** Merged global settings: DB row wins over projectConfig value when non-null. */
export interface EffectiveGlobalSettings {
  perWorkflowMaxUsd?: number;
  maxParallelAgents?: number;
  dailyTokens?: number;
  maxRetries?: number;
  perAdvisorMaxUsd?: number;
  perAgentMaxUsd?: number;
  perBashCommandMaxSeconds?: number;
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
    perAgentMaxUsd?: number;
    perBashCommandMaxSeconds?: number;
  },
): EffectiveGlobalSettings {
  const dbRow = readProjectSettings(projectId);
  return {
    perWorkflowMaxUsd: dbRow?.perWorkflowMaxUsd ?? projectBudgets?.perWorkflowMaxUsd,
    maxParallelAgents: dbRow?.maxParallelAgents ?? projectBudgets?.maxParallelAgents,
    dailyTokens: dbRow?.dailyTokens ?? projectBudgets?.dailyTokens,
    maxRetries: dbRow?.maxRetries ?? projectBudgets?.maxRetries,
    perAdvisorMaxUsd: dbRow?.perAdvisorMaxUsd ?? projectBudgets?.perAdvisorMaxUsd,
    perAgentMaxUsd: dbRow?.perAgentMaxUsd ?? projectBudgets?.perAgentMaxUsd,
    perBashCommandMaxSeconds:
      dbRow?.perBashCommandMaxSeconds ?? projectBudgets?.perBashCommandMaxSeconds,
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
    | {
        perWorkflowMaxUsd?: number;
        perAgentMaxUsd?: number;
        skillBudgetOverrides?: Record<string, SkillBudgetOverride>;
      }
    | undefined,
  projectId: string,
): ResolvedBudget {
  const skillRows = readProjectSkillSettings(projectId);
  const globalRow = readProjectSettings(projectId);
  return resolveBudgets(
    skill,
    projectBudgets,
    skillRows.get(skill),
    globalRow?.perWorkflowMaxUsd,
    globalRow?.perAgentMaxUsd,
  );
}

/**
 * resolveEscalatedBudgets with DB global caps applied.
 */
export function resolveEscalatedBudgetsForProject(
  skill: string,
  projectBudgets:
    | {
        perWorkflowMaxUsd?: number;
        perAgentMaxUsd?: number;
        skillBudgetOverrides?: Record<string, SkillBudgetOverride>;
      }
    | undefined,
  projectId: string,
): ResolvedBudget | null {
  const globalRow = readProjectSettings(projectId);
  return resolveEscalatedBudgets(
    skill,
    projectBudgets,
    globalRow?.perWorkflowMaxUsd,
    globalRow?.perAgentMaxUsd,
  );
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
