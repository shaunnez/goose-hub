import { join } from 'node:path';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { OutputValidationError, invokeSkill } from '@goose-hub/core/agent-runtime/invoke-skill.js';
import { reconcileDecisionSummaries } from '@goose-hub/core/agent-runtime/reconcile-decisions.js';
import { transitionAndEmitState } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { ProjectConfig } from '@goose-hub/core/types.js';
import {
  type GrillAndPrdResult,
  type ProjectContextBundle,
  runGrillAndPrdWorkflow,
} from '@goose-hub/core/workflows/grill-and-prd.js';
import type { FeatureFrameOutput } from '@goose-hub/skills/feature-frame/schema.js';

type FramingProjectConfig = Pick<ProjectConfig, 'budgets' | 'stack' | 'targetRepo'>;

export interface RunFramingWorkflowInput {
  workItem: WorkItem;
  stateSource: StateSource;
  projectId: string;
  priorReplies?: Array<{ role: 'user' | 'agent'; content: string }>;
  deps?: {
    runtime?: AgentRuntime;
    projectConfig?: FramingProjectConfig | null;
    totalSpendForSkill?: (projectId: string, skill: string) => number;
    buildContext?: (localPath: string) => Promise<ProjectContextBundle>;
    createWorktreeImpl?: (repoPath: string, runId: string) => string;
    cleanupWorktreeImpl?: (runId: string) => void;
    repoRoot?: string;
  };
}

function appendFramedContent(originalBody: string, framedContent: string): string {
  const trimmedFrame = framedContent.trim();
  if (trimmedFrame === '') return originalBody;
  if (originalBody.trim() === '') return trimmedFrame;
  return `${originalBody.trimEnd()}\n\n${trimmedFrame}`;
}

function workItemContextNumber(externalId: string): number | string {
  const trimmed = externalId.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : externalId;
}

function expandHomePath(path: string | undefined): string | undefined {
  if (path == null || path === '') return undefined;
  return path.startsWith('~/') ? join(process.env.HOME ?? '/root', path.slice(2)) : path;
}

async function transitionFromFraming(input: {
  source: StateSource;
  workItem: WorkItem;
  projectId: string;
  runId: string;
  to: StateName;
}): Promise<void> {
  try {
    await transitionAndEmitState({
      mode: 'legal',
      source: input.source,
      itemId: input.workItem.externalId,
      projectId: input.projectId,
      workItemId: input.workItem.id,
      from: 'factory:framing',
      to: input.to,
      by: 'feature-frame',
      runId: input.runId,
    });
  } catch {
    await transitionAndEmitState({
      mode: 'forced',
      source: input.source,
      itemId: input.workItem.externalId,
      projectId: input.projectId,
      workItemId: input.workItem.id,
      from: input.workItem.state,
      to: input.to,
      by: 'feature-frame',
      runId: input.runId,
      reason: 'framing-transition-fallback',
    });
  }
}

export async function runFramingWorkflow(
  input: RunFramingWorkflowInput,
): Promise<GrillAndPrdResult> {
  const { workItem, stateSource, projectId, deps = {} } = input;
  const workflowRunId = crypto.randomUUID();
  const frameRunId = `${workflowRunId}:feature-frame`;
  const projectConfig =
    deps.projectConfig !== undefined ? deps.projectConfig : await getProjectBySlug(projectId);
  const workspaceDir = expandHomePath(deps.repoRoot ?? projectConfig?.targetRepo?.localPath);

  if (workItem.state !== 'factory:framing') {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId: workItem.id,
      runId: workflowRunId,
      payload: {
        skill: 'feature-frame',
        workflowRunId,
        error: `expected workItem.state 'factory:framing', got '${workItem.state}'`,
      },
    });
    return { phase: 'needs-human' };
  }

  let featureFrame: FeatureFrameOutput;
  try {
    const result = await invokeSkill({
      skillName: 'feature-frame',
      projectId,
      workItemId: workItem.id,
      runId: frameRunId,
      context: {
        workItem: {
          title: workItem.title,
          body: workItem.body,
          number: workItemContextNumber(workItem.externalId),
        },
      },
      overrides: {
        runtimeOverride: deps.runtime,
        projectConfigOverride: projectConfig,
        ...(workspaceDir != null ? { workspaceDir } : {}),
        extraEventPayload: { workflowRunId },
      },
    });
    featureFrame = result.output as FeatureFrameOutput;
  } catch (err) {
    eventStore.appendEvent({
      kind: 'agent.run-failed',
      projectId,
      workItemId: workItem.id,
      runId: frameRunId,
      payload: {
        skill: 'feature-frame',
        workflowRunId,
        error: err instanceof OutputValidationError ? err.message : String(err),
        ...(err instanceof OutputValidationError ? { issues: err.issues } : {}),
      },
    });
    return { phase: 'needs-human' };
  }

  reconcileDecisionSummaries(
    frameRunId,
    projectId,
    workItem.id,
    'feature-frame',
    featureFrame.decisionSummaries,
  );

  const framedBody = appendFramedContent(workItem.body, featureFrame.framedContent);
  const nextState = featureFrame.stillNeedsGrilling ? 'factory:grilling' : 'factory:prd-drafting';
  await transitionFromFraming({
    source: stateSource,
    workItem,
    projectId,
    runId: frameRunId,
    to: nextState,
  });

  const framedWorkItem: WorkItem = {
    ...workItem,
    body: framedBody,
    state: nextState,
  };

  return runGrillAndPrdWorkflow({
    workItem: framedWorkItem,
    stateSource,
    projectId,
    priorReplies: input.priorReplies ?? [],
    skipGrill: !featureFrame.stillNeedsGrilling,
    refinedIntent: featureFrame.refinedIntent,
    deps: {
      runtime: deps.runtime,
      projectConfig,
      totalSpendForSkill: deps.totalSpendForSkill,
      buildContext: deps.buildContext,
      createWorktreeImpl: deps.createWorktreeImpl,
      cleanupWorktreeImpl: deps.cleanupWorktreeImpl,
      repoRoot: deps.repoRoot,
    },
  });
}
