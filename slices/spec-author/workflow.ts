import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { invokeSkill } from '@goose-hub/core/agent-runtime/invoke-skill.js';
import { persistEngineeringSpec } from '@goose-hub/core/engineering-specs/repository.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { listScoutReportsForInvestigation } from '@goose-hub/core/scout-reports/repository.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { cleanupWorktree, createWorktree } from '@goose-hub/core/workspaces/worktree.js';
import type { EngineeringSpec } from '@goose-hub/skills/spec-author/schema.js';
import { validateEngineeringSpec } from '@goose-hub/skills/spec-author/validate.js';

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

function recordStateTransition(
  projectId: string,
  workItemId: string,
  from: 'factory:dev-ready',
  to: 'factory:spec-ready' | 'factory:needs-human',
): void {
  eventStore.appendEvent({
    projectId,
    workItemId,
    kind: 'state.transitioned',
    payload: { from, to, by: 'spec-author' },
  });
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

    if (latestInv != null) {
      const payload = latestInv.payload as { investigationRunId?: string };
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
    }

    const workItemCtx = {
      number: Number(workItem.externalId),
      title: workItem.title,
      body: workItem.body,
    };

    const result = await invokeSkill({
      skillName: 'spec-author',
      projectId,
      workItemId: workItem.id,
      runId: pipelineRunId,
      context: {
        workItem: workItemCtx,
        worktreePath,
        issueType: workItem.type === 'bug' ? 'bug' : 'feature',
        scoutReports,
        wave2Reports,
      },
    });

    const spec = result.output as EngineeringSpec;

    // Structural validation (business rules beyond schema shape).
    const validation = validateEngineeringSpec(spec, {
      issueType: workItem.type === 'bug' ? 'bug' : 'feature',
    });

    if (!validation.ok) {
      const errors = validation.errors.map((e) => e.message).join('; ');
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.run-failed',
        payload: {
          runId: pipelineRunId,
          skill: 'spec-author',
          error: `Validation failed: ${errors}`,
        },
        runId: pipelineRunId,
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
      recordStateTransition(projectId, workItem.id, 'factory:dev-ready', 'factory:needs-human');
      return;
    }

    persistEngineeringSpec(projectId, workItem.id, pipelineRunId, spec);

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'spec.completed',
      payload: { pipelineRunId, workItemId: workItem.id },
      runId: pipelineRunId,
    });

    await stateSource.transitionState(
      workItem.externalId,
      'factory:dev-ready',
      'factory:spec-ready',
    );
    recordStateTransition(projectId, workItem.id, 'factory:dev-ready', 'factory:spec-ready');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const outputValidationIssues = formatOutputValidationIssues(error);

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: {
        runId: pipelineRunId,
        skill: 'spec-author',
        error: error.message,
        ...(outputValidationIssues.length > 0 && { issues: outputValidationIssues }),
      },
      runId: pipelineRunId,
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
    recordStateTransition(projectId, workItem.id, 'factory:dev-ready', 'factory:needs-human');
  } finally {
    cleanupWorktree(pipelineRunId);
  }
}
