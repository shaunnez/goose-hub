import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { invokeSkill } from '@goose-hub/core/agent-runtime/invoke-skill.js';
import { reconcileDecisionSummaries } from '@goose-hub/core/agent-runtime/reconcile-decisions.js';
import { transitionAndEmitState } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import type { ScoutReportDigestBundle } from '@goose-hub/core/scout-reports/digest.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { resolveRepositoryForWorkItem } from '@goose-hub/core/workspaces/repo-affinity.js';
import { resolveWorkflowBaseForWorkItem } from '@goose-hub/core/workspaces/workflow-base.js';
import { cleanupWorktree, createWorktree } from '@goose-hub/core/workspaces/worktree.js';
import type { ResearchOutput } from '@goose-hub/skills/research/schema.js';

type ResearchWorkflowDeps = {
  runtime?: AgentRuntime;
  createWorktreeImpl?: (
    repoPath: string,
    runId: string,
    baseRef?: string,
    repoRef?: string,
  ) => string;
  cleanupWorktreeImpl?: (runIdOrPath: string, repoRef?: string) => void;
  scoutDigest?: ScoutReportDigestBundle;
};

export type ResearchWorkflowResult =
  | { status: 'success'; workflowRunId: string; researchRunId: string; worktreePath: string }
  | { status: 'failed'; workflowRunId: string; researchRunId: string; error: string };

function workItemNumber(externalId: string): number {
  const parsed = Number(externalId);
  return Number.isFinite(parsed) ? parsed : 0;
}

function researchContext(workItem: WorkItem, scoutDigest: ScoutReportDigestBundle | undefined) {
  return {
    workItem: {
      title: workItem.title,
      body: workItem.body,
      number: workItemNumber(workItem.externalId),
    },
    ...(scoutDigest != null ? { scoutDigest } : {}),
  };
}

async function failResearchWorkflow(input: {
  source: StateSource;
  workItem: WorkItem;
  projectId: string;
  workflowRunId: string;
  researchRunId: string;
  error: Error;
}): Promise<ResearchWorkflowResult> {
  eventStore.appendEvent({
    kind: 'agent.run-failed',
    projectId: input.projectId,
    workItemId: input.workItem.id,
    runId: input.researchRunId,
    payload: {
      skill: 'research',
      workflowRunId: input.workflowRunId,
      error: input.error.message,
    },
  });
  try {
    await input.source.comment(
      input.workItem.externalId,
      `Research failed before a valid research artifact could be produced.\n\nError: ${input.error.message}`,
    );
  } catch {
    // Failure telemetry is already durable; comment write best-effort cannot block cleanup.
  }
  try {
    await transitionAndEmitState({
      mode: 'forced',
      source: input.source,
      itemId: input.workItem.externalId,
      projectId: input.projectId,
      workItemId: input.workItem.id,
      from: input.workItem.state,
      to: 'factory:needs-human',
      by: 'research',
      runId: input.researchRunId,
      reason: 'research-workflow-failed',
    });
  } catch {
    // The run-failed event remains the durable resume signal if label recovery fails.
  }
  return {
    status: 'failed',
    workflowRunId: input.workflowRunId,
    researchRunId: input.researchRunId,
    error: input.error.message,
  };
}

export async function runResearchWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  projectId: string,
  repoRoot: string,
  deps: ResearchWorkflowDeps = {},
): Promise<ResearchWorkflowResult> {
  const workflowRunId = crypto.randomUUID();
  const researchRunId = `${workflowRunId}:research`;
  let worktreePath: string | null = null;
  const createWorktreeImpl = deps.createWorktreeImpl ?? createWorktree;
  const cleanupWorktreeImpl = deps.cleanupWorktreeImpl ?? cleanupWorktree;

  try {
    if (workItem.state !== 'factory:research-pending') {
      throw new Error(`expected workItem.state 'factory:research-pending', got '${workItem.state}'`);
    }

    const project = await getProjectBySlug(projectId);
    const selectedRepository = resolveRepositoryForWorkItem({
      project,
      workItem,
      fallbackLocalPath: repoRoot,
    });
    const workflowBase = resolveWorkflowBaseForWorkItem(
      projectId,
      workItem.id,
      selectedRepository.localPath,
      selectedRepository.defaultBranch,
    );
    worktreePath = createWorktreeImpl(
      selectedRepository.localPath,
      workflowRunId,
      workflowBase.ref,
      selectedRepository.repoRef,
    );

    const result = await invokeSkill({
      skillName: 'research',
      projectId,
      workItemId: workItem.id,
      runId: researchRunId,
      context: researchContext(workItem, deps.scoutDigest),
      overrides: {
        runtimeOverride: deps.runtime,
        workspaceDir: worktreePath,
        projectConfigOverride: project,
        extraEventPayload: {
          workflowRunId,
          workflowBase,
          targetRepo: selectedRepository.repoRef,
        },
      },
    });
    const research = result.output as ResearchOutput;
    reconcileDecisionSummaries(
      researchRunId,
      projectId,
      workItem.id,
      'research',
      research.decisionSummaries,
    );
    eventStore.appendEvent({
      kind: 'agent.research-complete',
      projectId,
      workItemId: workItem.id,
      runId: researchRunId,
      payload: {
        research,
        workflowRunId,
        researchRunId,
        targetRepo: selectedRepository.repoRef,
        workflowBase,
      },
    });
    await transitionAndEmitState({
      mode: 'legal',
      source: stateSource,
      itemId: workItem.externalId,
      projectId,
      workItemId: workItem.id,
      from: 'factory:research-pending',
      to: 'factory:research-complete',
      by: 'research',
      runId: researchRunId,
    });

    return { status: 'success', workflowRunId, researchRunId, worktreePath };
  } catch (err) {
    return await failResearchWorkflow({
      source: stateSource,
      workItem,
      projectId,
      workflowRunId,
      researchRunId,
      error: err instanceof Error ? err : new Error(String(err)),
    });
  } finally {
    if (worktreePath != null) {
      cleanupWorktreeImpl(worktreePath);
    }
  }
}
