import type { AgentConfig, ModelTier, Role, RoleModel } from '../types.js';
import type { SkillConfig } from './interface.js';
import { ROLE_DEFAULTS } from './roles.js';

const HOLDOUT_ROLES = new Set<string>(['qa', 'reviewer']);

export interface RoleModelResult {
  primary: ModelTier;
  fallback: ModelTier | null;
  advisor: ModelTier | null;
  /** Which layer provided the primary tier. */
  source: 'db' | 'project-config' | 'skill-default' | 'role-default';
}

export interface DbRoleModelParams {
  primaryModel?: string | null;
  fallbackModel?: string | null;
  advisorModel?: string | null;
}

function isValidTier(v: string | null | undefined): v is ModelTier {
  return v === 'haiku' || v === 'sonnet' || v === 'opus';
}

/**
 * Resolves the model tier assignment for a role.
 *
 * Resolution order (highest wins):
 *   1. DB row (project_model_settings) — UI-editable
 *   2. agentConfig.rolesModels[role] — project.config.ts
 *   3. skillConfig.modelPin — skill default
 *   4. ROLE_DEFAULTS[role].modelTier — hard-coded fallback
 *
 * Holdout gating: qa and reviewer overrides are silently dropped unless
 * agentConfig.allowHoldoutOverride === true. This protects holdout
 * integrity regardless of how the project config is tuned.
 *
 * Pure function — no DB access. Use selectModelForRoleForProject() when
 * a projectId is available so the DB layer is consulted.
 */
export function selectModelForRole(
  role: Role,
  agentConfig: Pick<AgentConfig, 'rolesModels' | 'allowHoldoutOverride'> | undefined,
  skillConfig: Pick<SkillConfig, 'modelPin'> | undefined,
  dbParams?: DbRoleModelParams,
): RoleModelResult {
  const isHoldout = HOLDOUT_ROLES.has(role);
  const allowOverride = agentConfig?.allowHoldoutOverride === true;

  // DB override — dropped for holdout roles unless allowHoldoutOverride
  if (dbParams != null && (!isHoldout || allowOverride)) {
    if (isValidTier(dbParams.primaryModel)) {
      return {
        primary: dbParams.primaryModel,
        fallback: isValidTier(dbParams.fallbackModel) ? dbParams.fallbackModel : null,
        advisor: isValidTier(dbParams.advisorModel) ? dbParams.advisorModel : null,
        source: 'db',
      };
    }
  }

  // Project config rolesModels — dropped for holdout roles unless allowHoldoutOverride
  const configEntry: RoleModel | undefined = agentConfig?.rolesModels[role];
  if (configEntry != null && (!isHoldout || allowOverride)) {
    return {
      primary: configEntry.primary,
      fallback: configEntry.fallback,
      advisor: configEntry.advisor,
      source: 'project-config',
    };
  }

  // Skill modelPin
  if (skillConfig?.modelPin != null) {
    return {
      primary: skillConfig.modelPin,
      fallback: null,
      advisor: null,
      source: 'skill-default',
    };
  }

  // Hard-coded role default
  const roleDefault = ROLE_DEFAULTS[role];
  return {
    primary: roleDefault?.modelTier ?? 'sonnet',
    fallback: null,
    advisor: null,
    source: 'role-default',
  };
}
