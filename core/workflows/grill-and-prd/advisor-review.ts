import type { AdvisePRDOutput } from '../../../skills/advise-on-prd/schema.js';
import { AdvisePRDOutputSchema } from '../../../skills/advise-on-prd/schema.js';
import type { PRDOutput } from '../../../skills/write-prd/schema.js';
import type { AgentRuntime } from '../../agent-runtime/interface.js';
import { OutputValidationError, invokeSkill } from '../../agent-runtime/invoke-skill.js';
import {
  resolveBudgetsForProject,
  resolveGlobalSettingsForProject,
} from '../../agent-runtime/resolve-for-project.js';
import type { ProjectConfig } from '../../types.js';

const FALLBACK_ADVISOR_BUDGET = {
  budgets: { maxTurns: 15, maxBudgetUsd: 1.0, timeoutMs: 180_000 },
  modelOverride: 'opus',
};

export type AdvisorOutcome =
  | { status: 'skipped'; reason: 'priority' | 'budget' }
  | {
      status: 'ok';
      prdOutput: PRDOutput;
      concerns: string[] | null;
      decisionSummaries: AdvisePRDOutput['decisionSummaries'];
    }
  | { status: 'invalid'; error: string }
  | { status: 'failed'; error: string };

export interface RunAdvisorReviewInput {
  workItem: { id: string; priority: string };
  projectId: string;
  workItemId: string;
  runId: string;
  workflowRunId: string;
  prdOutput: PRDOutput;
  projectConfig?: Pick<ProjectConfig, 'budgets' | 'stack' | 'targetRepo'> | null;
  totalSpendForSkill: (projectId: string, skill: string) => number;
  deps?: { runtime?: AgentRuntime };
}

export async function runAdvisorReview(input: RunAdvisorReviewInput): Promise<AdvisorOutcome> {
  const {
    workItem,
    projectId,
    workItemId,
    runId,
    workflowRunId,
    prdOutput,
    projectConfig,
    totalSpendForSkill,
    deps,
  } = input;

  if (workItem.priority !== 'high' && workItem.priority !== 'critical') {
    return { status: 'skipped', reason: 'priority' };
  }

  let advisorBudget: {
    budgets: { maxTurns: number; maxBudgetUsd: number; timeoutMs: number };
    modelOverride: string;
  };
  try {
    advisorBudget = resolveBudgetsForProject('advise-on-prd', projectConfig?.budgets, projectId);
  } catch {
    advisorBudget = FALLBACK_ADVISOR_BUDGET;
  }

  const globalSettings = resolveGlobalSettingsForProject(projectId, projectConfig?.budgets);
  const perAdvisorMaxUsd = globalSettings.perAdvisorMaxUsd ?? Number.POSITIVE_INFINITY;
  const advisorSpentUsd = totalSpendForSkill(projectId, 'advise-on-prd');

  if (advisorSpentUsd + advisorBudget.budgets.maxBudgetUsd > perAdvisorMaxUsd) {
    return { status: 'skipped', reason: 'budget' };
  }

  let result: Awaited<ReturnType<typeof invokeSkill>>;

  try {
    result = await invokeSkill({
      skillName: 'advise-on-prd',
      projectId,
      workItemId,
      runId,
      context: {
        projectId,
        workItemId,
        prdOutput,
        priority: workItem.priority,
      },
      overrides: { runtimeOverride: deps?.runtime, extraEventPayload: { workflowRunId } },
    });
  } catch (err) {
    if (err instanceof OutputValidationError) {
      return { status: 'invalid', error: err.message };
    }
    return { status: 'failed', error: String(err) };
  }

  const parsed = AdvisePRDOutputSchema.safeParse(result.output);
  if (!parsed.success) {
    return { status: 'invalid', error: parsed.error.message };
  }

  const advisor = parsed.data;
  let mergedOutput = prdOutput;
  if (Object.keys(advisor.revisedSections).length > 0) {
    mergedOutput = {
      ...prdOutput,
      ...(advisor.revisedSections as unknown as Partial<typeof prdOutput>),
    };
  }

  return {
    status: 'ok',
    prdOutput: mergedOutput,
    concerns: advisor.concerns.length > 0 ? advisor.concerns : null,
    decisionSummaries: advisor.decisionSummaries,
  };
}
