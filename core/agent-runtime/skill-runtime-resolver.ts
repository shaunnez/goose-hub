import type { ProjectSkillSettingsRow } from '../db/repositories/project-settings.js';
import {
  readProjectSettings,
  readProjectSkillSettings,
} from '../db/repositories/project-settings.js';
import type { BudgetConfig, ModelProvider, ModelTier } from '../types.js';
import type { ResolvedBudget, SkillBudgetOverride } from './budgets.js';
import { SKILL_BUDGETS, resolveBudgets } from './budgets.js';
import { defaultModelForTierAndProvider, providerOf, tierOf } from './models.js';
import type { ConfigRuntime } from './select-runtime.js';

export type SkillRuntimeSource = 'caller' | 'db' | 'config' | 'skill-default' | 'fallback';

export interface SkillRuntimeDbOverride {
  maxTurns?: number | null;
  maxBudgetUsd?: number | null;
  timeoutMs?: number | null;
  modelTier?: ModelTier | string | null;
  modelProvider?: ModelProvider | string | null;
}

export interface ResolvedDisplayModel {
  tier: ModelTier;
  provider: ModelProvider;
  modelId: string;
}

export interface ResolvedSkillRuntime extends ResolvedBudget {
  tier: ModelTier;
  provider: ModelProvider;
  source: SkillRuntimeSource;
  resolvedPrimary: ResolvedDisplayModel;
  resolvedFallback: ResolvedDisplayModel | null;
  resolvedAdvisor: ResolvedDisplayModel | null;
}

const TIER_ORDER: ModelTier[] = ['haiku', 'sonnet', 'opus'];

function isModelTier(value: unknown): value is ModelTier {
  return value === 'haiku' || value === 'sonnet' || value === 'opus';
}

function isModelProvider(value: unknown): value is ModelProvider {
  return value === 'claude' || value === 'codex';
}

export function lowerTier(tier: ModelTier): ModelTier {
  const index = Math.max(0, TIER_ORDER.indexOf(tier) - 1);
  return TIER_ORDER[index] ?? 'haiku';
}

export function higherTier(tier: ModelTier): ModelTier {
  const index = Math.min(TIER_ORDER.length - 1, TIER_ORDER.indexOf(tier) + 1);
  return TIER_ORDER[index] ?? 'opus';
}

export function forcedProviderFromRuntime(configRuntime: ConfigRuntime): ModelProvider | null {
  if (configRuntime === 'codex-cli') return 'codex';
  if (configRuntime === 'claude-cli') return 'claude';
  return null;
}

function displayModel(tier: ModelTier, provider: ModelProvider): ResolvedDisplayModel {
  return { tier, provider, modelId: defaultModelForTierAndProvider(tier, provider) };
}

function fallbackBudget(tier: ModelTier, provider: ModelProvider): ResolvedBudget {
  return {
    budgets: { maxTurns: 25, maxBudgetUsd: 1, timeoutMs: 120_000 },
    modelOverride: defaultModelForTierAndProvider(tier, provider),
  };
}

function sourceForSkill(
  skill: string,
  dbOverride?: SkillRuntimeDbOverride | null,
): SkillRuntimeSource {
  if (isModelTier(dbOverride?.modelTier) || isModelProvider(dbOverride?.modelProvider)) return 'db';
  if (SKILL_BUDGETS[skill] != null) return 'skill-default';
  return 'fallback';
}

function resolveTier(input: {
  skill: string;
  projectBudgets?: Pick<BudgetConfig, 'skillBudgetOverrides'>;
  dbOverride?: SkillRuntimeDbOverride | null;
  fallbackTier?: ModelTier;
}): { tier: ModelTier; source: SkillRuntimeSource } {
  if (isModelTier(input.dbOverride?.modelTier)) {
    return { tier: input.dbOverride.modelTier, source: 'db' };
  }

  const configTier = input.projectBudgets?.skillBudgetOverrides?.[input.skill]?.modelTier;
  if (isModelTier(configTier)) {
    return { tier: configTier, source: 'config' };
  }

  const skillTier = SKILL_BUDGETS[input.skill]?.modelTier;
  if (skillTier != null) {
    return { tier: skillTier, source: sourceForSkill(input.skill, input.dbOverride) };
  }

  return { tier: input.fallbackTier ?? 'sonnet', source: 'fallback' };
}

function withoutConfigModelTier(
  projectBudgets: Parameters<typeof resolveSkillRuntime>[0]['projectBudgets'],
): Parameters<typeof resolveSkillRuntime>[0]['projectBudgets'] {
  if (projectBudgets?.skillBudgetOverrides == null) return projectBudgets;
  const skillBudgetOverrides: Record<string, SkillBudgetOverride> = {};
  for (const [skill, override] of Object.entries(projectBudgets.skillBudgetOverrides)) {
    const { modelTier: _modelTier, ...rest } = override;
    skillBudgetOverrides[skill] = rest;
  }
  return { ...projectBudgets, skillBudgetOverrides };
}

export function resolveSkillRuntime(input: {
  skill: string;
  projectBudgets?: {
    perWorkflowMaxUsd?: number;
    perAgentMaxUsd?: number;
    skillBudgetOverrides?: Record<string, SkillBudgetOverride>;
  };
  dbOverride?: SkillRuntimeDbOverride | null;
  dbPerWorkflowMaxUsd?: number | null;
  dbPerAgentMaxUsd?: number | null;
  configRuntime?: ConfigRuntime;
  skillProvider?: ModelProvider;
  fallbackTier?: ModelTier;
  fallbackProvider?: ModelProvider;
  callerModelOverride?: string;
  role?: string;
  allowHoldoutOverride?: boolean;
  ignoreProviderOverride?: boolean;
}): ResolvedSkillRuntime {
  const configRuntime = input.configRuntime ?? 'auto';
  const isHoldout = input.role === 'qa' || input.role === 'reviewer';
  const honourModelOverrides = !isHoldout || input.allowHoldoutOverride === true;
  const dbOverride = honourModelOverrides
    ? input.dbOverride
    : input.dbOverride == null
      ? input.dbOverride
      : { ...input.dbOverride, modelTier: null, modelProvider: null };
  const modelProjectBudgets = honourModelOverrides
    ? input.projectBudgets
    : withoutConfigModelTier(input.projectBudgets);
  const providerConfigRuntime = input.ignoreProviderOverride ? 'auto' : configRuntime;
  let resolvedBudget: ResolvedBudget;
  try {
    resolvedBudget = resolveBudgets(
      input.skill,
      input.projectBudgets,
      dbOverride ?? undefined,
      input.dbPerWorkflowMaxUsd,
      input.dbPerAgentMaxUsd,
    );
  } catch {
    resolvedBudget = fallbackBudget(
      input.fallbackTier ?? 'sonnet',
      forcedProviderFromRuntime(providerConfigRuntime) ??
        (!input.ignoreProviderOverride && isModelProvider(dbOverride?.modelProvider)
          ? dbOverride.modelProvider
          : (input.skillProvider ?? input.fallbackProvider ?? 'claude')),
    );
  }

  if (input.callerModelOverride != null) {
    const tier = tierOf(input.callerModelOverride);
    const provider = providerOf(input.callerModelOverride);
    return {
      ...resolvedBudget,
      modelOverride: input.callerModelOverride,
      tier,
      provider,
      source: 'caller',
      resolvedPrimary: { tier, provider, modelId: input.callerModelOverride },
      resolvedFallback: null,
      resolvedAdvisor: null,
    };
  }

  const tierResult = resolveTier({
    skill: input.skill,
    projectBudgets: modelProjectBudgets,
    dbOverride,
    fallbackTier: input.fallbackTier,
  });
  const provider =
    forcedProviderFromRuntime(providerConfigRuntime) ??
    (!input.ignoreProviderOverride && isModelProvider(dbOverride?.modelProvider)
      ? dbOverride.modelProvider
      : (input.skillProvider ?? input.fallbackProvider ?? 'claude'));
  const modelOverride = defaultModelForTierAndProvider(tierResult.tier, provider);
  const supportsFallback = SKILL_BUDGETS[input.skill]?.escalation != null;
  const supportsAdvisor = input.skill === 'implement' || input.skill === 'write-prd';

  return {
    ...resolvedBudget,
    modelOverride,
    tier: tierResult.tier,
    provider,
    source: isModelProvider(dbOverride?.modelProvider) ? 'db' : tierResult.source,
    resolvedPrimary: displayModel(tierResult.tier, provider),
    resolvedFallback:
      !isHoldout && supportsFallback ? displayModel(lowerTier(tierResult.tier), provider) : null,
    resolvedAdvisor:
      !isHoldout && supportsAdvisor ? displayModel(higherTier(tierResult.tier), provider) : null,
  };
}

export function resolveSkillRuntimeForProject(input: {
  skill: string;
  projectBudgets?: {
    perWorkflowMaxUsd?: number;
    perAgentMaxUsd?: number;
    skillBudgetOverrides?: Record<string, SkillBudgetOverride>;
  };
  projectId: string;
  configRuntime?: ConfigRuntime;
  skillProvider?: ModelProvider;
  fallbackTier?: ModelTier;
  fallbackProvider?: ModelProvider;
  callerModelOverride?: string;
  role?: string;
  allowHoldoutOverride?: boolean;
  ignoreProviderOverride?: boolean;
}): ResolvedSkillRuntime {
  const skillRows = readProjectSkillSettings(input.projectId);
  const globalRow = readProjectSettings(input.projectId);
  return resolveSkillRuntime({
    ...input,
    dbOverride: skillRows.get(input.skill),
    dbPerWorkflowMaxUsd: globalRow?.perWorkflowMaxUsd,
    dbPerAgentMaxUsd: globalRow?.perAgentMaxUsd,
  });
}

export function deriveSkillRuntimeResponse(input: {
  skill: string;
  row?: ProjectSkillSettingsRow | null;
  projectBudgets?: BudgetConfig;
  configRuntime?: ConfigRuntime;
  role?: string;
  allowHoldoutOverride?: boolean;
}): ResolvedSkillRuntime {
  return resolveSkillRuntime({
    skill: input.skill,
    projectBudgets: input.projectBudgets,
    dbOverride: input.row,
    configRuntime: input.configRuntime,
    role: input.role,
    allowHoldoutOverride: input.allowHoldoutOverride,
  });
}
