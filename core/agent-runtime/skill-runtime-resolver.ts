import type { ProjectSkillSettingsRow } from '../db/repositories/project-settings.js';
import {
  readProjectSettings,
  readProjectSkillSettings,
} from '../db/repositories/project-settings.js';
import type { BudgetConfig, ModelProvider, ModelTier, Role, RuntimeEffort } from '../types.js';
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
  effort?: RuntimeEffort | string | null;
}

export interface ResolvedDisplayModel {
  tier: ModelTier;
  provider: ModelProvider;
  modelId: string;
}

export interface RuntimeTraceDecision<T> {
  value: T;
  source: SkillRuntimeSource;
  reason: string;
}

export interface RuntimeResolutionTrace {
  tier: RuntimeTraceDecision<ModelTier>;
  provider: RuntimeTraceDecision<ModelProvider>;
  effort?: RuntimeTraceDecision<RuntimeEffort>;
}

export interface ResolvedSkillRuntime extends ResolvedBudget {
  tier: ModelTier;
  provider: ModelProvider;
  source: SkillRuntimeSource;
  selectionReason: string;
  runtimeTrace: RuntimeResolutionTrace;
  resolvedPrimary: ResolvedDisplayModel;
  resolvedFallback: ResolvedDisplayModel | null;
  resolvedAdvisor: ResolvedDisplayModel | null;
  effort?: RuntimeEffort;
}

const TIER_ORDER: ModelTier[] = ['haiku', 'sonnet', 'opus'];

function isModelTier(value: unknown): value is ModelTier {
  return value === 'haiku' || value === 'sonnet' || value === 'opus';
}

function isModelProvider(value: unknown): value is ModelProvider {
  return value === 'claude' || value === 'codex';
}

function isRuntimeEffort(value: unknown): value is RuntimeEffort {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh';
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

function resolveTierDecision(input: {
  skill: string;
  projectBudgets?: Pick<BudgetConfig, 'skillBudgetOverrides'>;
  dbOverride?: SkillRuntimeDbOverride | null;
  fallbackTier?: ModelTier;
  suppressedModelOverride?: boolean;
}): RuntimeTraceDecision<ModelTier> {
  if (isModelTier(input.dbOverride?.modelTier)) {
    return {
      value: input.dbOverride.modelTier,
      source: 'db',
      reason: 'project_skill_settings.model_tier override',
    };
  }

  const configTier = input.projectBudgets?.skillBudgetOverrides?.[input.skill]?.modelTier;
  if (isModelTier(configTier)) {
    return {
      value: configTier,
      source: 'config',
      reason: `project config budgets.skillBudgetOverrides.${input.skill}.modelTier`,
    };
  }

  const skillTier = SKILL_BUDGETS[input.skill]?.modelTier;
  if (skillTier != null) {
    return {
      value: skillTier,
      source: 'skill-default',
      reason:
        input.suppressedModelOverride === true
          ? 'holdout skill ignores DB/config tier overrides; using SKILL_BUDGETS default'
          : 'SKILL_BUDGETS default tier',
    };
  }

  return {
    value: input.fallbackTier ?? 'sonnet',
    source: 'fallback',
    reason: input.fallbackTier != null ? 'caller fallbackTier' : 'resolver fallback tier',
  };
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

function resolveProviderDecision(input: {
  skill: string;
  dbOverride?: SkillRuntimeDbOverride | null;
  providerConfigRuntime: ConfigRuntime;
  skillProvider?: ModelProvider;
  fallbackProvider?: ModelProvider;
  ignoreProviderOverride?: boolean;
  suppressedModelOverride?: boolean;
}): RuntimeTraceDecision<ModelProvider> {
  const forcedProvider = forcedProviderFromRuntime(input.providerConfigRuntime);
  if (forcedProvider != null) {
    return {
      value: forcedProvider,
      source: 'config',
      reason: `${input.providerConfigRuntime} forces provider ${forcedProvider}`,
    };
  }

  if (!input.ignoreProviderOverride && isModelProvider(input.dbOverride?.modelProvider)) {
    return {
      value: input.dbOverride.modelProvider,
      source: 'db',
      reason: 'project_skill_settings.model_provider override',
    };
  }

  if (input.skillProvider != null) {
    return {
      value: input.skillProvider,
      source: 'skill-default',
      reason:
        input.ignoreProviderOverride === true
          ? 'provider override ignored for injected runtime; using skill provider hint'
          : 'skill runtime provider hint',
    };
  }

  const skillProvider = SKILL_BUDGETS[input.skill]?.provider;
  if (skillProvider != null) {
    return {
      value: skillProvider,
      source: 'skill-default',
      reason:
        input.ignoreProviderOverride === true
          ? 'provider override ignored for injected runtime; using SKILL_BUDGETS provider'
          : 'SKILL_BUDGETS provider',
    };
  }

  if (input.fallbackProvider != null) {
    return {
      value: input.fallbackProvider,
      source: 'fallback',
      reason: 'caller fallbackProvider',
    };
  }

  return {
    value: 'claude',
    source: 'fallback',
    reason:
      input.ignoreProviderOverride === true
        ? 'provider override ignored for injected runtime; using resolver fallback provider'
        : input.suppressedModelOverride === true
          ? 'holdout skill ignores DB/config provider overrides; using resolver fallback provider'
          : 'resolver fallback provider',
  };
}

function resolveEffortDecision(input: {
  skill: string;
  projectBudgets?: Pick<BudgetConfig, 'skillBudgetOverrides'>;
  dbOverride?: SkillRuntimeDbOverride | null;
}): RuntimeTraceDecision<RuntimeEffort> | null {
  if (isRuntimeEffort(input.dbOverride?.effort)) {
    return {
      value: input.dbOverride.effort,
      source: 'db',
      reason: 'project_skill_settings.effort override',
    };
  }
  const configEffort = input.projectBudgets?.skillBudgetOverrides?.[input.skill]?.effort;
  if (isRuntimeEffort(configEffort)) {
    return {
      value: configEffort,
      source: 'config',
      reason: `project config budgets.skillBudgetOverrides.${input.skill}.effort`,
    };
  }
  const skillEffort = SKILL_BUDGETS[input.skill]?.effort;
  if (isRuntimeEffort(skillEffort)) {
    return {
      value: skillEffort,
      source: 'skill-default',
      reason: 'SKILL_BUDGETS default effort',
    };
  }
  return null;
}

function legacySourceFromTrace(
  trace: RuntimeResolutionTrace,
  dbOverride?: SkillRuntimeDbOverride | null,
): SkillRuntimeSource {
  if (trace.tier.source === 'caller' || trace.provider.source === 'caller') return 'caller';
  if (isModelProvider(dbOverride?.modelProvider)) return 'db';
  if (trace.tier.source === 'db' || trace.provider.source === 'db') return 'db';
  if (trace.effort?.source === 'db') return 'db';
  return trace.effort?.source ?? trace.tier.source;
}

function selectionReasonFromTrace(trace: RuntimeResolutionTrace): string {
  const effort = trace.effort != null ? `, effort ${trace.effort.source}` : '';
  return `tier ${trace.tier.source}, provider ${trace.provider.source}${effort}`;
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
  role?: Role;
  allowHoldoutOverride?: boolean;
  ignoreProviderOverride?: boolean;
}): ResolvedSkillRuntime {
  const configRuntime = input.configRuntime ?? 'auto';
  const isHoldout = input.role === 'qa' || input.role === 'reviewer';
  const honourModelOverrides = !isHoldout || input.allowHoldoutOverride === true;
  const suppressedModelOverride =
    !honourModelOverrides &&
    (isModelTier(input.dbOverride?.modelTier) ||
      isModelProvider(input.dbOverride?.modelProvider) ||
      input.projectBudgets?.skillBudgetOverrides?.[input.skill]?.modelTier != null);
  const dbOverride = honourModelOverrides
    ? input.dbOverride
    : input.dbOverride == null
      ? input.dbOverride
      : { ...input.dbOverride, modelTier: null, modelProvider: null };
  const modelProjectBudgets = honourModelOverrides
    ? input.projectBudgets
    : withoutConfigModelTier(input.projectBudgets);
  const providerConfigRuntime = input.ignoreProviderOverride ? 'auto' : configRuntime;
  const resolvedBudget: ResolvedBudget = resolveBudgets(
    input.skill,
    input.projectBudgets,
    dbOverride ?? undefined,
    input.dbPerWorkflowMaxUsd,
    input.dbPerAgentMaxUsd,
  );

  if (input.callerModelOverride != null) {
    const tier = tierOf(input.callerModelOverride);
    const provider = providerOf(input.callerModelOverride);
    const effortResult = resolveEffortDecision({
      skill: input.skill,
      projectBudgets: input.projectBudgets,
      dbOverride,
    });
    const runtimeTrace: RuntimeResolutionTrace = {
      tier: {
        value: tier,
        source: 'caller',
        reason: 'caller supplied concrete modelOverride',
      },
      provider: {
        value: provider,
        source: 'caller',
        reason: 'caller supplied concrete modelOverride',
      },
      ...(effortResult != null ? { effort: effortResult } : {}),
    };
    return {
      ...resolvedBudget,
      modelOverride: input.callerModelOverride,
      tier,
      provider,
      source: 'caller',
      selectionReason: selectionReasonFromTrace(runtimeTrace),
      runtimeTrace,
      resolvedPrimary: { tier, provider, modelId: input.callerModelOverride },
      resolvedFallback: null,
      resolvedAdvisor: null,
      effort: resolvedBudget.effort,
    };
  }

  const tierResult = resolveTierDecision({
    skill: input.skill,
    projectBudgets: modelProjectBudgets,
    dbOverride,
    fallbackTier: input.fallbackTier,
    suppressedModelOverride,
  });
  const providerResult = resolveProviderDecision({
    skill: input.skill,
    dbOverride,
    providerConfigRuntime,
    skillProvider: input.skillProvider,
    fallbackProvider: input.fallbackProvider,
    ignoreProviderOverride: input.ignoreProviderOverride,
    suppressedModelOverride,
  });
  const tier = tierResult.value;
  const provider = providerResult.value;
  const modelOverride = defaultModelForTierAndProvider(tier, provider);
  const supportsFallback = SKILL_BUDGETS[input.skill]?.escalation != null;
  const supportsAdvisor = input.skill === 'implement' || input.skill === 'write-prd';
  const effortResult = resolveEffortDecision({
    skill: input.skill,
    projectBudgets: input.projectBudgets,
    dbOverride,
  });
  const runtimeTrace: RuntimeResolutionTrace = {
    tier: tierResult,
    provider: providerResult,
    ...(effortResult != null ? { effort: effortResult } : {}),
  };
  const source = legacySourceFromTrace(runtimeTrace, dbOverride);

  return {
    ...resolvedBudget,
    modelOverride,
    tier,
    provider,
    source,
    selectionReason: selectionReasonFromTrace(runtimeTrace),
    runtimeTrace,
    resolvedPrimary: displayModel(tier, provider),
    resolvedFallback:
      !isHoldout && supportsFallback ? displayModel(lowerTier(tier), provider) : null,
    resolvedAdvisor:
      !isHoldout && supportsAdvisor ? displayModel(higherTier(tier), provider) : null,
    ...(effortResult?.value != null ? { effort: effortResult.value } : {}),
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
  role?: Role;
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
  role?: Role;
  allowHoldoutOverride?: boolean;
  skillProvider?: ModelProvider;
  fallbackTier?: ModelTier;
  fallbackProvider?: ModelProvider;
}): ResolvedSkillRuntime {
  return resolveSkillRuntime({
    skill: input.skill,
    projectBudgets: input.projectBudgets,
    dbOverride: input.row,
    configRuntime: input.configRuntime,
    role: input.role,
    allowHoldoutOverride: input.allowHoldoutOverride,
    skillProvider: input.skillProvider,
    fallbackTier: input.fallbackTier,
    fallbackProvider: input.fallbackProvider,
  });
}
