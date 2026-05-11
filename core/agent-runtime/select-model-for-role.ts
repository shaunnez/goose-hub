import type { ProjectModelSettingsRow } from '../db/repositories/project-model-settings.js';
import type { ModelProvider, ModelTier, Role, RoleModel } from '../types.js';
import { SKILL_BUDGETS } from './budgets.js';
import { defaultModelForTierAndProvider } from './models.js';
import { HOLDOUT_ROLES, ROLE_DEFAULTS } from './roles.js';

export interface SelectModelForRoleInput {
  role: Role;
  /** agentConfig.rolesModels[role] from the project config (optional). */
  configRoleModel?: RoleModel;
  /** Project-config flag — when false, holdout roles ignore DB/config overrides. */
  allowHoldoutOverride?: boolean;
  /** DB row from project_model_settings (optional). */
  dbRow?: ProjectModelSettingsRow | null;
  /** Skill name; used to read SKILL_BUDGETS[skill].modelTier as the skill default. */
  skill?: string;
  /** Skill-declared provider (used as a tiebreaker if the role has no provider preference). */
  skillProvider?: ModelProvider;
}

export interface SelectModelForRoleResult {
  tier: ModelTier;
  provider: ModelProvider;
  /** Concrete model ID, resolved via defaultModelForTierAndProvider. */
  modelId: string;
  /** Which resolution layer won. Useful for debugging + decision summaries. */
  source: 'db' | 'config' | 'skill' | 'role-default';
}

/**
 * Pure resolver for the per-role primary model. Returns a (tier, provider) pair
 * plus the resolved concrete model ID.
 *
 * Resolution order (highest wins):
 *   1. dbRow.primaryModel / primaryProvider (UI-editable)
 *   2. configRoleModel.primary / primaryProvider (project.config.ts rolesModels)
 *   3. SKILL_BUDGETS[skill].modelTier (skill modelPin) + skillProvider
 *   4. ROLE_DEFAULTS[role].modelTier (claude default)
 *
 * Holdout gating: when `allowHoldoutOverride` is not true, holdout roles
 * (qa, reviewer) skip layers 1 and 2 entirely and fall through to skill/role
 * defaults. This protects holdout integrity from accidental downgrade.
 */
export function selectModelForRole(input: SelectModelForRoleInput): SelectModelForRoleResult {
  const { role, configRoleModel, allowHoldoutOverride, dbRow, skill, skillProvider } = input;
  const isHoldout = HOLDOUT_ROLES.has(role);
  const honourOverrides = !isHoldout || allowHoldoutOverride === true;

  // 1. DB row (highest)
  if (honourOverrides && dbRow?.primaryModel != null) {
    const tier = dbRow.primaryModel as ModelTier;
    const provider = (dbRow.primaryProvider as ModelProvider | null) ?? 'claude';
    return {
      tier,
      provider,
      modelId: defaultModelForTierAndProvider(tier, provider),
      source: 'db',
    };
  }

  // 2. Project config rolesModels
  if (honourOverrides && configRoleModel?.primary != null) {
    const tier = configRoleModel.primary;
    const provider = configRoleModel.primaryProvider ?? 'claude';
    return {
      tier,
      provider,
      modelId: defaultModelForTierAndProvider(tier, provider),
      source: 'config',
    };
  }

  // 3. Skill default tier + skill provider hint
  if (skill != null) {
    const skillBudget = SKILL_BUDGETS[skill];
    if (skillBudget?.modelTier != null) {
      const tier = skillBudget.modelTier;
      const provider: ModelProvider = skillProvider ?? 'claude';
      return {
        tier,
        provider,
        modelId: defaultModelForTierAndProvider(tier, provider),
        source: 'skill',
      };
    }
  }

  // 4. Role default — always claude
  const tier = ROLE_DEFAULTS[role]?.modelTier ?? 'sonnet';
  return {
    tier,
    provider: 'claude',
    modelId: defaultModelForTierAndProvider(tier, 'claude'),
    source: 'role-default',
  };
}
