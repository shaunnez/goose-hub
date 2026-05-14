import { eventStore } from '../event-stream/store.js';

export interface BudgetGuardInput {
  runId: string;
  skill: string;
  modelId: string;
  costUsd: number;
  maxBudgetUsd: number;
  inputTokens: number;
  outputTokens: number;
  projectId: string;
  workItemId: string | null;
  personaId: string | null | undefined;
}

export function emitBudgetExceededIfNeeded(input: BudgetGuardInput): boolean {
  if (input.costUsd <= input.maxBudgetUsd) return false;

  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'agent.budget-exceeded',
    payload: {
      runId: input.runId,
      skill: input.skill,
      modelId: input.modelId,
      costUsd: input.costUsd,
      budgetUsd: input.maxBudgetUsd,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      overByUsd: Number((input.costUsd - input.maxBudgetUsd).toFixed(6)),
    },
    runId: input.runId,
    personaId: input.personaId,
  });

  return true;
}
