import type { ProjectSettingsRow } from '../db/repositories/project-settings.js';
import type { BudgetConfig } from '../types.js';

export type ImplementWpBudgetConfig = {
  perAgentMaxUsd?: number;
  perWorkflowMaxUsd?: number;
  implementWp?: BudgetConfig['implementWp'];
};

export type ImplementWpSettings = {
  editTestLoopMaxCycles: number;
  budgetSizing: {
    bug: { maxTurns: number; maxBudgetUsd: number };
    feature: { maxTurns: number; maxBudgetUsd: number };
    complex: { maxTurns: number; maxBudgetUsd: number };
    complexAdditions: {
      highPriorityUsd: number;
      manyFilesThreshold: number;
      manyFilesUsd: number;
      contractKeywords: string[];
      contractUsd: number;
    };
  };
};

export type ImplementWpSettingsRow = Pick<
  ProjectSettingsRow,
  | 'perAgentMaxUsd'
  | 'perWorkflowMaxUsd'
  | 'implementWpEditTestLoopMaxCycles'
  | 'implementWpBugMaxTurns'
  | 'implementWpBugMaxBudgetUsd'
  | 'implementWpFeatureMaxTurns'
  | 'implementWpFeatureMaxBudgetUsd'
  | 'implementWpComplexMaxTurns'
  | 'implementWpComplexMaxBudgetUsd'
  | 'implementWpHighPriorityUsd'
  | 'implementWpManyFilesThreshold'
  | 'implementWpManyFilesUsd'
  | 'implementWpContractKeywordsJson'
  | 'implementWpContractUsd'
>;

export const DEFAULT_IMPLEMENT_WP_SETTINGS: ImplementWpSettings = {
  editTestLoopMaxCycles: 3,
  budgetSizing: {
    bug: { maxTurns: 70, maxBudgetUsd: 4 },
    feature: { maxTurns: 100, maxBudgetUsd: 6 },
    complex: { maxTurns: 130, maxBudgetUsd: 8 },
    complexAdditions: {
      highPriorityUsd: 1,
      manyFilesThreshold: 3,
      manyFilesUsd: 1,
      contractKeywords: ['schema', 'migration', 'api'],
      contractUsd: 1,
    },
  },
};

function parseContractKeywords(value: string | null | undefined): string[] | null {
  if (value == null) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const keywords = parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return keywords.length > 0 ? keywords : [];
  } catch {
    return null;
  }
}

export function resolveImplementWpSettings(
  budgetConfig?: Pick<BudgetConfig, 'implementWp'> | null,
  row?: ImplementWpSettingsRow | null,
): ImplementWpSettings {
  const config = budgetConfig?.implementWp;
  const sizing = config?.budgetSizing;
  const defaults = DEFAULT_IMPLEMENT_WP_SETTINGS;

  return {
    editTestLoopMaxCycles:
      row?.implementWpEditTestLoopMaxCycles ??
      config?.editTestLoopMaxCycles ??
      defaults.editTestLoopMaxCycles,
    budgetSizing: {
      bug: {
        maxTurns:
          row?.implementWpBugMaxTurns ??
          sizing?.bug?.maxTurns ??
          defaults.budgetSizing.bug.maxTurns,
        maxBudgetUsd:
          row?.implementWpBugMaxBudgetUsd ??
          sizing?.bug?.maxBudgetUsd ??
          defaults.budgetSizing.bug.maxBudgetUsd,
      },
      feature: {
        maxTurns:
          row?.implementWpFeatureMaxTurns ??
          sizing?.feature?.maxTurns ??
          defaults.budgetSizing.feature.maxTurns,
        maxBudgetUsd:
          row?.implementWpFeatureMaxBudgetUsd ??
          sizing?.feature?.maxBudgetUsd ??
          defaults.budgetSizing.feature.maxBudgetUsd,
      },
      complex: {
        maxTurns:
          row?.implementWpComplexMaxTurns ??
          sizing?.complex?.maxTurns ??
          defaults.budgetSizing.complex.maxTurns,
        maxBudgetUsd:
          row?.implementWpComplexMaxBudgetUsd ??
          sizing?.complex?.maxBudgetUsd ??
          defaults.budgetSizing.complex.maxBudgetUsd,
      },
      complexAdditions: {
        highPriorityUsd:
          row?.implementWpHighPriorityUsd ??
          sizing?.complexAdditions?.highPriorityUsd ??
          defaults.budgetSizing.complexAdditions.highPriorityUsd,
        manyFilesThreshold:
          row?.implementWpManyFilesThreshold ??
          sizing?.complexAdditions?.manyFilesThreshold ??
          defaults.budgetSizing.complexAdditions.manyFilesThreshold,
        manyFilesUsd:
          row?.implementWpManyFilesUsd ??
          sizing?.complexAdditions?.manyFilesUsd ??
          defaults.budgetSizing.complexAdditions.manyFilesUsd,
        contractKeywords:
          parseContractKeywords(row?.implementWpContractKeywordsJson) ??
          sizing?.complexAdditions?.contractKeywords ??
          defaults.budgetSizing.complexAdditions.contractKeywords,
        contractUsd:
          row?.implementWpContractUsd ??
          sizing?.complexAdditions?.contractUsd ??
          defaults.budgetSizing.complexAdditions.contractUsd,
      },
    },
  };
}

export function resolveImplementWpBudgetConfig(
  budgetConfig?: ImplementWpBudgetConfig | null,
  row?: ImplementWpSettingsRow | null,
): ImplementWpBudgetConfig {
  const settings = resolveImplementWpSettings(budgetConfig, row);
  return {
    perAgentMaxUsd: row?.perAgentMaxUsd ?? budgetConfig?.perAgentMaxUsd,
    perWorkflowMaxUsd: row?.perWorkflowMaxUsd ?? budgetConfig?.perWorkflowMaxUsd,
    implementWp: settings,
  };
}
