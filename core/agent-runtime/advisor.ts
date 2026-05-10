import {
  type AdviseOnPlanOutput,
  AdviseOnPlanSchema,
} from '@goose-hub/skills/advise-on-plan/schema.js';
import { eventStore } from '../event-stream/store.js';
import type { AgentRuntime } from './interface.js';
import type { AgentResult } from './interface.js';
import { OutputValidationError, invokeSkill } from './invoke-skill.js';
import { reconcileDecisionSummaries } from './reconcile-decisions.js';

interface AdviseOnPlanInput {
  runId: string;
  projectId: string;
  workItemId: string;
  workItem: { title: string; body: string; number: number; priority: 'high' | 'critical' };
  plan: string;
  /** Pass 0 (first review) by default; 1 for the post-revise re-spawn. */
  revisionPass?: 0 | 1;
  /** The advisor's own pass-0 output, only present when revisionPass === 1. */
  previousAdvisorFeedback?: string;
  /** Optional runtime override — defaults to a new ClaudeCliRuntime. */
  runtime?: AgentRuntime;
}

const ADVISOR_GATED_PRIORITIES = new Set(['high', 'critical']);

/**
 * adviseOnPlan(input) (#182).
 *
 * Wraps the advise-on-plan skill in a fresh-context spawn for high/critical
 * priority work items. Returns the typed advisor output. The caller (the
 * fix-issue workflow, M7.05) inspects the verdict and decides whether to
 * proceed, re-spawn the primary with feedback, or escalate to human.
 *
 * Side effect: emits one agent.decision-summary event per entry in the
 * advisor's decisionSummaries array, plus an agent.run-failed event when
 * the priority is not advisor-gated (catches caller bugs).
 *
 * Throws if the priority isn't 'high'|'critical' (call-site mistake) OR
 * the advisor output fails Zod validation (skill misbehaviour).
 */
export async function adviseOnPlan(input: AdviseOnPlanInput): Promise<AdviseOnPlanOutput> {
  if (!ADVISOR_GATED_PRIORITIES.has(input.workItem.priority)) {
    throw new Error(
      `adviseOnPlan called with priority='${input.workItem.priority}' — only high/critical are advisor-gated`,
    );
  }

  let result: AgentResult;
  try {
    result = await invokeSkill({
      skillName: 'advise-on-plan',
      projectId: input.projectId,
      workItemId: input.workItemId,
      runId: input.runId,
      context: {
        workItem: input.workItem,
        plan: input.plan,
        revisionPass: input.revisionPass ?? 0,
        previousAdvisorFeedback: input.previousAdvisorFeedback,
      },
      overrides: { runtimeOverride: input.runtime },
    });
  } catch (err) {
    if (err instanceof OutputValidationError) {
      eventStore.appendEvent({
        projectId: input.projectId,
        workItemId: input.workItemId,
        kind: 'agent.run-failed',
        payload: { runId: input.runId, error: 'advise-on-plan output validation failed' },
        runId: input.runId,
      });
      throw new Error('advise-on-plan output validation failed');
    }
    throw err;
  }

  // invokeSkill already validated result.output against AdviseOnPlanSchema via outputSchema
  const parsed = AdviseOnPlanSchema.parse(result.output);

  reconcileDecisionSummaries(
    input.runId,
    input.projectId,
    input.workItemId,
    'advise-on-plan',
    parsed.decisionSummaries,
  );

  return parsed;
}
