import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { invokeSkill } from '@goose-hub/core/agent-runtime/invoke-skill.js';
import { persistEngineeringSpec } from '@goose-hub/core/engineering-specs/repository.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { listScoutReportsForInvestigation } from '@goose-hub/core/scout-reports/repository.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { cleanupWorktree, createWorktree } from '@goose-hub/core/workspaces/worktree.js';
import {
  type EngineeringSpec,
  EngineeringSpecSchema,
} from '@goose-hub/skills/spec-author/schema.js';
import {
  type ValidationResult,
  validateEngineeringSpec,
} from '@goose-hub/skills/spec-author/validate.js';

export interface SpecAuthorWorkflowDeps {
  createWorktreeImpl?: typeof createWorktree;
}

type OutputValidationIssue = {
  path: Array<string | number>;
  message: string;
};

function formatOutputValidationIssues(error: Error): string[] {
  if (error.name !== 'OutputValidationError') return [];

  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];

  return issues.flatMap((issue) => {
    if (issue == null || typeof issue !== 'object') return [];
    const candidate = issue as Partial<OutputValidationIssue>;
    if (!Array.isArray(candidate.path) || typeof candidate.message !== 'string') return [];

    const path = candidate.path.length > 0 ? candidate.path.join('.') : '<root>';
    return `${path}: ${candidate.message}`;
  });
}

type SpecAuthorContext = {
  workItem: {
    number: number;
    title: string;
    body: string;
  };
  worktreePath: string;
  issueType: 'feature' | 'bug';
  scoutReports?: string;
  wave2Reports?: string;
  investigationSynthesis?: string;
};

type SpecAttempt = {
  runId: string;
  spec: EngineeringSpec;
  validation: ValidationResult;
};

function formatValidationErrors(validation: Exclude<ValidationResult, { ok: true }>): string[] {
  return validation.errors.map((e) => e.message);
}

function buildRepairFeedback(kind: 'schema' | 'structural', errors: string[]): string {
  return [
    `Previous spec-author attempt failed ${kind} validation.`,
    'Return a complete corrected EngineeringSpecSchema JSON object only.',
    'Address every error below:',
    ...errors.map((error) => `- ${error}`),
  ].join('\n');
}

function appendRepairRetryEvent(
  projectId: string,
  workItemId: string,
  runId: string,
  kind: 'schema' | 'structural',
  errors: string[],
): void {
  eventStore.appendEvent({
    projectId,
    workItemId,
    kind: 'agent.log',
    payload: {
      runId,
      skill: 'spec-author',
      stream: 'validation',
      text: `Spec author ${kind} validation failed; retrying once.\n${errors.join('\n')}`,
    },
    runId,
  });
}

function errorRunId(error: Error, fallbackRunId: string): string {
  const telemetry = (error as { runTelemetry?: { runId?: unknown } }).runTelemetry;
  return typeof telemetry?.runId === 'string' ? telemetry.runId : fallbackRunId;
}

function normalizeSpecAuthorOutput(output: unknown): EngineeringSpec {
  const spec = EngineeringSpecSchema.parse(output);

  return {
    ...spec,
    interfaceContracts: spec.interfaceContracts.map((contract) => {
      const next = { ...contract };
      if (next.lineRange == null) next.lineRange = undefined;
      return next;
    }),
    verificationTooling: spec.verificationTooling.map((tool) => {
      const next = { ...tool };
      if (next.inputSpec == null) next.inputSpec = undefined;
      return next;
    }),
    acceptanceCriteria: spec.acceptanceCriteria.map((criterion) => {
      const next = { ...criterion };
      if (next.journeyRef == null) next.journeyRef = undefined;
      if (next.stepIdx == null) next.stepIdx = undefined;
      if (next.tolerance == null) next.tolerance = undefined;
      if (next.crossCutting == null) next.crossCutting = undefined;
      if (next.source == null) next.source = undefined;
      return next;
    }),
  };
}

/**
 * Runs the spec-author workflow for a work item in `factory:dev-ready` state.
 *
 * Workflow:
 * 1. Generate pipelineRunId (UUID per PR lifecycle — M19.17 §4)
 * 2. createWorktree for the target repo
 * 3. Load scout reports from DB (if prior investigation exists)
 * 4. invokeSkill('spec-author') with full context
 * 5. validateEngineeringSpec for structural rules
 * 6. If invalid → post comment + transition to factory:needs-human
 * 7. persistEngineeringSpec to DB
 * 8. Emit spec.completed event (carries pipelineRunId + workItemId)
 * 9. Transition: factory:dev-ready → factory:spec-ready
 *
 * On failure: cleanup worktree, emit agent.run-failed, post comment,
 * transition to factory:needs-human.
 */
export async function runSpecAuthorWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  projectId: string,
  targetRepo: string,
  deps: SpecAuthorWorkflowDeps = {},
): Promise<void> {
  const createWtFn = deps.createWorktreeImpl ?? createWorktree;

  const pipelineRunId = crypto.randomUUID();
  const worktreePath = createWtFn(targetRepo, pipelineRunId);

  try {
    // Load scout reports from the most recent investigation for this work item.
    const [latestInv] = eventStore.replay({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.investigation-complete',
      order: 'desc',
      limit: 1,
    });

    let scoutReports: string | undefined;
    let wave2Reports: string | undefined;
    let investigationSynthesis: string | undefined;

    if (latestInv != null) {
      const payload = latestInv.payload as { investigationRunId?: string; investigate?: unknown };
      if (payload.investigationRunId) {
        const allReports = listScoutReportsForInvestigation(
          projectId,
          workItem.id,
          payload.investigationRunId,
        );
        const wave1 = allReports.filter((r) => !r.scoutSkill.startsWith('wave2-'));
        const wave2 = allReports.filter((r) => r.scoutSkill.startsWith('wave2-'));
        if (wave1.length > 0) scoutReports = JSON.stringify(wave1);
        if (wave2.length > 0) wave2Reports = JSON.stringify(wave2);
      }
      if (payload.investigate != null) {
        investigationSynthesis = JSON.stringify(payload.investigate);
      }
    }

    const workItemCtx = {
      number: Number(workItem.externalId),
      title: workItem.title,
      body: workItem.body,
    };

    const baseContext: SpecAuthorContext = {
      workItem: workItemCtx,
      worktreePath,
      issueType: workItem.type === 'bug' ? 'bug' : 'feature',
      scoutReports,
      wave2Reports,
      investigationSynthesis,
    };

    const runAttempt = async (
      runId: string,
      repairFeedback?: string,
      repairOf?: string,
    ): Promise<SpecAttempt> => {
      const result = await invokeSkill({
        skillName: 'spec-author',
        projectId,
        workItemId: workItem.id,
        runId,
        context: baseContext,
        overrides: {
          workspaceDir: worktreePath,
          ...(repairFeedback != null && {
            appendContext: { repairFeedback },
            extraEventPayload: { attempt: 'repair', repairOf },
          }),
        },
      });

      const spec = normalizeSpecAuthorOutput(result.output);
      return {
        runId,
        spec,
        validation: validateEngineeringSpec(spec, {
          issueType: workItem.type === 'bug' ? 'bug' : 'feature',
        }),
      };
    };

    let attempt: SpecAttempt;
    let didRepair = false;

    try {
      attempt = await runAttempt(pipelineRunId);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const issues = formatOutputValidationIssues(error);
      if (issues.length === 0) throw error;

      didRepair = true;
      const failedRunId = errorRunId(error, pipelineRunId);
      const retryRunId = crypto.randomUUID();
      appendRepairRetryEvent(projectId, workItem.id, failedRunId, 'schema', issues);
      attempt = await runAttempt(retryRunId, buildRepairFeedback('schema', issues), failedRunId);
    }

    if (!attempt.validation.ok && !didRepair) {
      didRepair = true;
      const errors = formatValidationErrors(attempt.validation);
      const retryRunId = crypto.randomUUID();
      appendRepairRetryEvent(projectId, workItem.id, attempt.runId, 'structural', errors);
      attempt = await runAttempt(
        retryRunId,
        buildRepairFeedback('structural', errors),
        attempt.runId,
      );
    }

    if (!attempt.validation.ok) {
      const errors = formatValidationErrors(attempt.validation).join('; ');
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.run-failed',
        payload: {
          runId: attempt.runId,
          skill: 'spec-author',
          error: `Validation failed: ${errors}`,
        },
        runId: attempt.runId,
      });
      await stateSource.comment(
        workItem.externalId,
        buildAgentComment(
          'Spec Author',
          'Validation Failed',
          'Engineering spec failed structural validation',
          [`Errors: ${errors}`],
        ),
      );
      await stateSource.transitionState(
        workItem.externalId,
        'factory:dev-ready',
        'factory:needs-human',
      );
      emitStateTransitionEvent({
        projectId,
        workItemId: workItem.id,
        from: 'factory:dev-ready',
        to: 'factory:needs-human',
        by: 'spec-author',
      });
      return;
    }

    persistEngineeringSpec(projectId, workItem.id, attempt.runId, attempt.spec);

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'spec.completed',
      payload: { pipelineRunId: attempt.runId, workItemId: workItem.id },
      runId: attempt.runId,
    });

    await stateSource.transitionState(
      workItem.externalId,
      'factory:dev-ready',
      'factory:spec-ready',
    );
    emitStateTransitionEvent({
      projectId,
      workItemId: workItem.id,
      from: 'factory:dev-ready',
      to: 'factory:spec-ready',
      by: 'spec-author',
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const outputValidationIssues = formatOutputValidationIssues(error);
    const failedRunId = errorRunId(error, pipelineRunId);

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: {
        runId: failedRunId,
        skill: 'spec-author',
        error: error.message,
        ...(outputValidationIssues.length > 0 && { issues: outputValidationIssues }),
      },
      runId: failedRunId,
    });

    const details = [
      `Error: ${error.message}`,
      ...outputValidationIssues.map((issue) => `Schema issue: ${issue}`),
    ];

    await stateSource.comment(
      workItem.externalId,
      buildAgentComment(
        'Spec Author',
        'Failed',
        'Spec authoring failed — escalating to needs-human',
        details,
      ),
    );

    await stateSource.transitionState(
      workItem.externalId,
      'factory:dev-ready',
      'factory:needs-human',
    );
    emitStateTransitionEvent({
      projectId,
      workItemId: workItem.id,
      from: 'factory:dev-ready',
      to: 'factory:needs-human',
      by: 'spec-author',
    });
  } finally {
    cleanupWorktree(pipelineRunId);
  }
}
