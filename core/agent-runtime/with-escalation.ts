import type { ZodIssue, ZodType } from 'zod';
import { eventStore } from '../event-stream/store.js';
import { redactSecrets } from '../tool-layer/secret-redaction.js';
import type { ModelTier } from '../types.js';
import type { SkillBudgetOverride } from './budgets.js';
import type { AgentResult, AgentRuntime, AgentSpec } from './interface.js';
import { HoldoutFallbackForbiddenError } from './interface.js';
import { defaultModelForTierAndProvider, providerOf, tierOf } from './models.js';
import { resolveEscalatedBudgetsForProject } from './resolve-for-project.js';
import { HOLDOUT_ROLES } from './roles.js';

// Local rank table — duplicates the order in models.ts but kept private here
// so we don't widen models.ts' public surface for one defensive check.
const TIER_RANK: Record<ModelTier, number> = { haiku: 0, sonnet: 1, opus: 2 };

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
  /** True when the first attempt failed validation and we retried at the escalated tier. */
  escalated: boolean;
}

/**
 * Runs an agent and parses its output against `schema`. If parsing fails AND
 * the skill has an escalation policy AND the spec's current tier is at or
 * below the escalation target, retries once at the escalated tier with a
 * recalculated budget. Holdout roles (qa, reviewer) never escalate; they
 * throw HoldoutFallbackForbiddenError on validation failure.
 *
 * Same-tier retry is permitted (e.g. opus→opus): the model gets one extra
 * shot with a recalculated budget. Strict downgrade is rejected.
 *
 * Subprocess errors (timeout, process death) are not caught here — those are
 * the responsibility of `withFallback`. This wrapper only handles
 * schema-validation failure on a successful run.
 *
 * Emits `agent.retry-escalated` with payload
 * `{ stage: 'model', runId, retryRunId, skill, fromModel, toModel, reason }`
 * before the retry. The retry uses a fresh runId for separate cost attribution.
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

  const escalated = resolveEscalatedBudgetsForProject(spec.skill, projectBudgets, projectId);
  if (escalated == null) {
    throw makeValidationError(spec.skill, parsed.error.issues, result.output, null);
  }

  const currentTier = spec.modelOverride != null ? tierOf(spec.modelOverride) : null;
  const targetTier = tierOf(escalated.modelOverride);
  const escalatedModelOverride =
    spec.modelOverride != null
      ? defaultModelForTierAndProvider(targetTier, providerOf(spec.modelOverride))
      : escalated.modelOverride;
  // Allow same-tier retry (e.g. opus→opus when there is no higher tier — give
  // the same model one more shot at producing valid output). Reject only
  // strict downgrade, which is a misconfiguration.
  if (currentTier != null && TIER_RANK[targetTier] < TIER_RANK[currentTier]) {
    throw makeValidationError(spec.skill, parsed.error.issues, result.output, null);
  }

  const retryRunId = crypto.randomUUID();
  const retrySpec: AgentSpec = {
    ...spec,
    runId: retryRunId,
    budgets: escalated.budgets,
    modelOverride: escalatedModelOverride,
    appendSystemPrompt: appendValidationRepairPrompt(
      spec.appendSystemPrompt,
      parsed.error.issues,
      result.output,
    ),
  };

  eventStore.appendEvent({
    projectId,
    workItemId: workItemId ?? null,
    kind: 'agent.retry-escalated',
    payload: {
      // `stage` discriminates this from QA/review escalations on the same
      // event kind. The retro `retriesGe2` trigger filters on stage so a
      // model-tier retry doesn't masquerade as a workflow retry.
      stage: 'model',
      runId: spec.runId,
      retryRunId,
      skill: spec.skill,
      fromModel: spec.modelOverride ?? null,
      toModel: escalatedModelOverride,
      reason: 'schema-validation-failed',
    },
    runId: retryRunId,
  });

  const retryResult = await runtime.run(retrySpec);
  const retryParsed = schema.safeParse(retryResult.output);
  if (!retryParsed.success) {
    eventStore.appendEvent({
      projectId,
      workItemId: workItemId ?? null,
      kind: 'agent.output-repair-failed',
      payload: {
        runId: spec.runId,
        retryRunId,
        skill: spec.skill,
        reason: 'terminal-output-validation-failed-after-repair-retry',
        message:
          'Implementation/tool execution may have succeeded; the failure is terminal JSON output validation.',
        originalValidationIssues: formatZodIssues(parsed.error.issues),
        repairValidationIssues: formatZodIssues(retryParsed.error.issues),
        originalRawOutputPreview: previewOutput(result.output),
        repairRawOutputPreview: previewOutput(retryResult.output),
      },
      runId: retryRunId,
    });
    throw makeValidationError(spec.skill, retryParsed.error.issues, retryResult.output, targetTier);
  }

  return { output: retryParsed.data, result: retryResult, escalated: true };
}

function appendValidationRepairPrompt(
  appendSystemPrompt: string | undefined,
  issues: ZodIssue[],
  rawOutput: unknown,
): string {
  const basePrompt = appendSystemPrompt?.trimEnd() ?? '';
  const repairPrompt = [
    '## Terminal JSON Validation Repair',
    '',
    'Your previous run completed, but its terminal JSON output failed schema validation.',
    'Do not redo implementation work, rerun commands, change files, or reopen the task.',
    'Preserve every truthful field from the previous output and return corrected JSON only.',
    'Repair only the terminal output shape and invalid values identified below.',
    '',
    'Validation issues:',
    JSON.stringify(formatZodIssues(issues), null, 2),
    '',
    'Invalid output preview:',
    previewOutput(rawOutput),
  ].join('\n');

  return basePrompt.length > 0 ? `${basePrompt}\n\n${repairPrompt}` : repairPrompt;
}

function formatZodIssues(
  issues: ZodIssue[],
): Array<{ path: string; message: string; code: string }> {
  return issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
    code: issue.code,
  }));
}

function previewOutput(rawOutput: unknown): string {
  const redacted = redactSecrets(rawOutput);
  const rawPreview = typeof redacted === 'string' ? redacted : safeStringify(redacted);
  return rawPreview.slice(0, 4000);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function makeValidationError(
  skill: string,
  issues: unknown,
  rawOutput: unknown,
  retriedAtTier: ModelTier | null,
): Error {
  const rawPreview = previewOutput(rawOutput).slice(0, 800);
  const suffix = retriedAtTier != null ? ` after ${retriedAtTier}-tier validation retry` : '';
  return new Error(
    `${skill} terminal output validation failed${suffix}; implementation/tool execution may have succeeded and only terminal JSON shape is invalid: ${JSON.stringify(issues)}\nRaw output (first 800 chars): ${rawPreview}`,
  );
}
