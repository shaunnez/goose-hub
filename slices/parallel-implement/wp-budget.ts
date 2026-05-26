import {
  DEFAULT_IMPLEMENT_WP_SETTINGS,
  type ImplementWpBudgetConfig,
  resolveImplementWpBudgetConfig,
} from '@goose-hub/core/agent-runtime/implement-wp-settings.js';
import type { AgentBudgets } from '@goose-hub/core/agent-runtime/interface.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { BudgetConfig } from '@goose-hub/core/types.js';
import { type WorkPackage, fileOwnedPath } from '@goose-hub/skills/spec-author/schema.js';

export interface ImplementWpControlConfig {
  editTestLoopMaxCycles: number;
}

export function resolveImplementWpControl(
  budgetConfig?: Pick<BudgetConfig, 'implementWp'>,
): ImplementWpControlConfig {
  return {
    editTestLoopMaxCycles:
      budgetConfig?.implementWp?.editTestLoopMaxCycles ??
      DEFAULT_IMPLEMENT_WP_SETTINGS.editTestLoopMaxCycles,
  };
}

export function resolveImplementWpBudget(input: {
  defaultBudgets: AgentBudgets;
  workItem: WorkItem;
  wp: WorkPackage;
  budgetConfig?: ImplementWpBudgetConfig;
}): AgentBudgets {
  const mergedBudgetConfig = resolveImplementWpBudgetConfig(input.budgetConfig);
  const sizing = {
    bug: {
      ...DEFAULT_IMPLEMENT_WP_SETTINGS.budgetSizing.bug,
      ...mergedBudgetConfig.implementWp?.budgetSizing?.bug,
    },
    feature: {
      ...DEFAULT_IMPLEMENT_WP_SETTINGS.budgetSizing.feature,
      ...mergedBudgetConfig.implementWp?.budgetSizing?.feature,
    },
    complex: {
      ...DEFAULT_IMPLEMENT_WP_SETTINGS.budgetSizing.complex,
      ...mergedBudgetConfig.implementWp?.budgetSizing?.complex,
    },
    complexAdditions: {
      ...DEFAULT_IMPLEMENT_WP_SETTINGS.budgetSizing.complexAdditions,
      ...mergedBudgetConfig.implementWp?.budgetSizing?.complexAdditions,
    },
  };

  const base = input.workItem.type === 'bug' ? sizing.bug : sizing.feature;
  let maxBudgetUsd = base.maxBudgetUsd;
  let maxTurns = base.maxTurns;
  let complex = false;

  if (input.workItem.priority === 'high' || input.workItem.priority === 'critical') {
    maxBudgetUsd += sizing.complexAdditions.highPriorityUsd;
    complex = true;
  }

  if (input.wp.filesOwned.map(fileOwnedPath).length > sizing.complexAdditions.manyFilesThreshold) {
    maxBudgetUsd += sizing.complexAdditions.manyFilesUsd;
    complex = true;
  }

  const searchable =
    `${input.wp.changes} ${input.wp.filesOwned.map(fileOwnedPath).join(' ')}`.toLowerCase();
  if (sizing.complexAdditions.contractKeywords.some((keyword) => searchable.includes(keyword))) {
    maxBudgetUsd += sizing.complexAdditions.contractUsd;
    complex = true;
  }

  if (complex) {
    maxBudgetUsd = Math.min(maxBudgetUsd, sizing.complex.maxBudgetUsd);
    maxTurns = Math.max(maxTurns, sizing.complex.maxTurns);
  }

  const workflowCap = mergedBudgetConfig.perWorkflowMaxUsd;
  if (workflowCap != null) maxBudgetUsd = Math.min(maxBudgetUsd, workflowCap);
  const agentCap = mergedBudgetConfig.perAgentMaxUsd;
  if (agentCap != null) maxBudgetUsd = Math.min(maxBudgetUsd, agentCap);

  maxBudgetUsd = Math.min(maxBudgetUsd, input.defaultBudgets.maxBudgetUsd);
  maxTurns = Math.min(maxTurns, input.defaultBudgets.maxTurns);

  return {
    ...input.defaultBudgets,
    maxTurns,
    maxBudgetUsd,
  };
}
