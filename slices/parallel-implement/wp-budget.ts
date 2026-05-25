import type { AgentBudgets } from '@goose-hub/core/agent-runtime/interface.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { BudgetConfig } from '@goose-hub/core/types.js';
import { type WorkPackage, fileOwnedPath } from '@goose-hub/skills/spec-author/schema.js';

export interface ImplementWpControlConfig {
  editTestLoopMaxCycles: number;
}

const DEFAULT_BUDGET_SIZING = {
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
};

export function resolveImplementWpControl(
  budgetConfig?: Pick<BudgetConfig, 'implementWp'>,
): ImplementWpControlConfig {
  return {
    editTestLoopMaxCycles: budgetConfig?.implementWp?.editTestLoopMaxCycles ?? 3,
  };
}

export function resolveImplementWpBudget(input: {
  defaultBudgets: AgentBudgets;
  workItem: WorkItem;
  wp: WorkPackage;
  budgetConfig?: Pick<BudgetConfig, 'perAgentMaxUsd' | 'perWorkflowMaxUsd' | 'implementWp'>;
}): AgentBudgets {
  const sizing = {
    bug: { ...DEFAULT_BUDGET_SIZING.bug, ...input.budgetConfig?.implementWp?.budgetSizing?.bug },
    feature: {
      ...DEFAULT_BUDGET_SIZING.feature,
      ...input.budgetConfig?.implementWp?.budgetSizing?.feature,
    },
    complex: {
      ...DEFAULT_BUDGET_SIZING.complex,
      ...input.budgetConfig?.implementWp?.budgetSizing?.complex,
    },
    complexAdditions: {
      ...DEFAULT_BUDGET_SIZING.complexAdditions,
      ...input.budgetConfig?.implementWp?.budgetSizing?.complexAdditions,
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

  const workflowCap = input.budgetConfig?.perWorkflowMaxUsd;
  if (workflowCap != null) maxBudgetUsd = Math.min(maxBudgetUsd, workflowCap);
  const agentCap = input.budgetConfig?.perAgentMaxUsd;
  if (agentCap != null) maxBudgetUsd = Math.min(maxBudgetUsd, agentCap);

  maxBudgetUsd = Math.min(maxBudgetUsd, input.defaultBudgets.maxBudgetUsd);
  maxTurns = Math.min(maxTurns, input.defaultBudgets.maxTurns);

  return {
    ...input.defaultBudgets,
    maxTurns,
    maxBudgetUsd,
  };
}
