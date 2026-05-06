import type { ZodType } from 'zod';
import { eventStore } from '../event-stream/store.js';
import { resolveEscalatedBudgets } from './budgets.js';
import type { SkillBudgetOverride } from './budgets.js';
import type { AgentResult, AgentRuntime, AgentSpec } from './interface.js';
import { HoldoutFallbackForbiddenError } from './interface.js';
import { tierOf } from './models.js';

const HOLDOUT_ROLES = new Set(['qa', 'reviewer']);

export interface RunWithEscalationInput<T> {
  runtime: AgentRuntime;
  spec: AgentSpec;
  schema: ZodType<T>;
  /** Project ID — required for the agent.retry-escalated event. */
  projectId: string;
  workItemId?: string | null;
  /** Project budget config, used to recalculate the escalated budget cap. */
  projectBudgets?: {
    perWorkflowMaxUsd?: number;
    skillBudgetOverrides?: Record<string, SkillBudgetOverride>;
  };
}

export interface RunWithEscalationResult<T> {
  output: T;
  result: AgentResult;
  /** True when the haiku attempt failed validation and we retried at sonnet. */
  escalated: boolean;
}

/**
 * Runs an agent and parses its output against `schema`. If parsing fails AND
 * the skill has an escalation policy AND the spec is currently at a tier below
 * the escalated tier, retries once at the escalated tier with a recalculated
 * budget. Holdout roles (qa, reviewer) never escalate; they throw
 * HoldoutFallbackForbiddenError on validation failure.
 *
 * Subprocess errors (timeout, process death) are not caught here — those are
 * the responsibility of `withFallback`. This wrapper only handles
 * schema-validation failure on a successful run.
 *
 * Emits `agent.retry-escalated` with payload
 * `{ runId, retryRunId, skill, fromModel, toModel, reason }` before the retry.
 * The retry uses a fresh runId for separate cost attribution.
 */
export async function runWithEscalation<T>(
  input: RunWithEscalationInput<T>,
): Promise<RunWithEscalationResult<T>> {
  const { runtime, spec, schema, projectId, workItemId, projectBudgets } = input;

  const result = await runtime.run(spec);
  const parsed = schema.safeParse(result.output);
  if (parsed.success) {
    return { output: parsed.data, result, escalated: false };
  }

  if (HOLDOUT_ROLES.has(spec.role)) {
    throw new HoldoutFallbackForbiddenError(spec.role);
  }

  const escalated = resolveEscalatedBudgets(spec.skill, projectBudgets);
  if (escalated == null) {
    throw makeValidationError(spec.skill, parsed.error.issues, result.output, false);
  }

  const currentTier = spec.modelOverride != null ? tierOf(spec.modelOverride) : null;
  const targetTier = tierOf(escalated.modelOverride);
  if (currentTier != null && currentTier === targetTier) {
    // Already at the escalation target — no upward room
    throw makeValidationError(spec.skill, parsed.error.issues, result.output, false);
  }

  const retryRunId = crypto.randomUUID();
  const retrySpec: AgentSpec = {
    ...spec,
    runId: retryRunId,
    budgets: escalated.budgets,
    modelOverride: escalated.modelOverride,
  };

  eventStore.appendEvent({
    projectId,
    workItemId: workItemId ?? null,
    kind: 'agent.retry-escalated',
    payload: {
      runId: spec.runId,
      retryRunId,
      skill: spec.skill,
      fromModel: spec.modelOverride ?? null,
      toModel: escalated.modelOverride,
      reason: 'schema-validation-failed',
    },
    runId: retryRunId,
  });

  const retryResult = await runtime.run(retrySpec);
  const retryParsed = schema.safeParse(retryResult.output);
  if (!retryParsed.success) {
    throw makeValidationError(spec.skill, retryParsed.error.issues, retryResult.output, true);
  }

  return { output: retryParsed.data, result: retryResult, escalated: true };
}

function makeValidationError(
  skill: string,
  issues: unknown,
  rawOutput: unknown,
  afterEscalation: boolean,
): Error {
  const rawPreview =
    typeof rawOutput === 'string'
      ? rawOutput.slice(0, 800)
      : JSON.stringify(rawOutput).slice(0, 800);
  const suffix = afterEscalation ? ' after sonnet escalation' : '';
  return new Error(
    `${skill} output validation failed${suffix}: ${JSON.stringify(issues)}\nRaw output (first 800 chars): ${rawPreview}`,
  );
}
