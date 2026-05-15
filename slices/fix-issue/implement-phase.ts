import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { selectModel } from '@goose-hub/core/agent-runtime/model-router.js';
import {
  type ModelProvider,
  type ModelTier,
  defaultModelForTierAndProvider,
  tierOf,
} from '@goose-hub/core/agent-runtime/models.js';
import { reconcileDecisionSummaries } from '@goose-hub/core/agent-runtime/reconcile-decisions.js';
import {
  resolveBudgetsForProject,
  resolveComplexityOverridesForProject,
  resolveRoleModelForProject,
} from '@goose-hub/core/agent-runtime/resolve-for-project.js';
import { selectRuntime } from '@goose-hub/core/agent-runtime/select-runtime.js';
import { runWithEscalation } from '@goose-hub/core/agent-runtime/with-escalation.js';
import type { openPR } from '@goose-hub/core/connectors/github/open-pr.js';
import { getEvidencePostEnabled } from '@goose-hub/core/db/repositories/project-settings.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { orchestratorCommitAll } from '@goose-hub/core/workspaces/orchestrator-git.js';
import { ImplementSchema } from '@goose-hub/skills/implement/schema.js';
import { buildPrBody, runEvidencePost } from './pr-helpers.js';
import type { ImplementOutputShape } from './types.js';

export type { ImplementOutputShape } from './types.js';

export interface RunImplementInput {
  execution: ImplementExecution;
  runId: string;
  projectId: string;
  workItem: WorkItem;
  worktreePath: string;
  stack: { testCommand: string; lintCommand?: string; typecheckCommand?: string };
  appendSystemPrompt: string;
  outputJsonSchema: Record<string, unknown>;
  personaId: string;
  advisorFeedback?: string;
  revisionPass?: 0 | 1;
}

export interface ImplementExecution {
  runtime: AgentRuntime;
  projectConfig: Awaited<ReturnType<typeof getProjectBySlug>>;
  budgets: ReturnType<typeof resolveBudgetsForProject>['budgets'];
  modelOverride: string;
  selectedTier: ModelTier;
  selectionReason: string;
  evidencePostEnabled: boolean;
}

export interface AfterImplementInput {
  implementOutput: ImplementOutputShape;
  workItem: WorkItem;
  stateSource: StateSource;
  projectId: string;
  targetRepo: string;
  runId: string;
  worktreePath: string;
  baseBranch: string;
  openPRFn: typeof openPR;
  runtime: AgentRuntime;
  evidencePostPrompt: string;
  evidencePostJsonSchema: Record<string, unknown>;
  resolveHeadShaFn: (worktreePath: string) => string;
  /** Orchestrator commits before openPR (ADR 0031 — builder no-commit rule). */
  orchestratorCommitFn: typeof orchestratorCommitAll;
}

function forcedProviderFromRuntime(configRuntime: string | undefined): ModelProvider | null {
  if (configRuntime === 'codex-cli') return 'codex';
  if (configRuntime === 'claude-cli') return 'claude';
  return null;
}

export async function resolveImplementExecution(input: {
  projectId: string;
  workItem: WorkItem;
  injectedRuntime?: AgentRuntime;
}): Promise<ImplementExecution> {
  const projectConfig = await getProjectBySlug(input.projectId);
  const settingsProjectId = projectConfig?.id ?? input.projectId;
  const evidencePostEnabled = getEvidencePostEnabled(
    settingsProjectId,
    projectConfig?.evidencePostEnabled !== false,
  );
  const { budgets, modelOverride: budgetModelOverride } = resolveBudgetsForProject(
    'implement',
    projectConfig?.budgets,
    input.projectId,
  );

  const dbComplexityOverrides = resolveComplexityOverridesForProject(
    'developer',
    input.projectId,
    projectConfig?.agentConfig?.modelRouter?.overrides,
  );
  const routerResult = selectModel({
    workItem: input.workItem,
    role: 'developer',
    projectId: input.projectId,
    modelRouterConfig: projectConfig?.agentConfig?.modelRouter,
    dbComplexityOverrides,
  });
  const selectedTier = routerResult?.tier ?? tierOf(budgetModelOverride);

  if (input.injectedRuntime != null) {
    return {
      runtime: input.injectedRuntime,
      projectConfig,
      budgets,
      modelOverride:
        routerResult != null
          ? defaultModelForTierAndProvider(routerResult.tier, 'claude')
          : budgetModelOverride,
      selectedTier,
      selectionReason: routerResult?.reason ?? 'budget-default',
      evidencePostEnabled,
    };
  }

  const roleModel = resolveRoleModelForProject({
    role: 'developer',
    projectId: input.projectId,
    configRoleModel: projectConfig?.agentConfig?.rolesModels?.developer,
    allowHoldoutOverride: projectConfig?.agentConfig?.allowHoldoutOverride,
    skill: 'implement',
  });
  const configRuntime = projectConfig?.agentConfig?.runtime ?? 'auto';
  const provider =
    forcedProviderFromRuntime(configRuntime) ??
    (roleModel.source === 'db' || roleModel.source === 'config' ? roleModel.provider : 'claude');
  const modelOverride = defaultModelForTierAndProvider(selectedTier, provider);
  const runtime = selectRuntime({ configRuntime, model: modelOverride });

  return {
    runtime,
    projectConfig,
    budgets,
    modelOverride,
    selectedTier,
    selectionReason: routerResult?.reason ?? 'budget-default',
    evidencePostEnabled,
  };
}

export async function runImplement(input: RunImplementInput): Promise<ImplementOutputShape> {
  const { execution } = input;

  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItem.id,
    kind: 'agent.model-selected',
    payload: {
      runId: input.runId,
      skill: 'implement',
      role: 'developer',
      selectedTier: execution.selectedTier,
      reason: execution.selectionReason,
    },
    runId: input.runId,
  });

  const { output } = await runWithEscalation({
    runtime: execution.runtime,
    schema: ImplementSchema,
    projectId: input.projectId,
    workItemId: input.workItem.id,
    projectBudgets: execution.projectConfig?.budgets,
    spec: {
      runId: input.runId,
      role: 'developer',
      skill: 'implement',
      context: {
        projectId: input.projectId,
        workItemId: input.workItem.id,
        workItem: {
          title: input.workItem.title,
          body: input.workItem.body,
          number: Number(input.workItem.externalId),
          priority: input.workItem.priority,
        },
        worktreePath: input.worktreePath,
        stack: input.stack,
        advisorFeedback: input.advisorFeedback,
        revisionPass: input.revisionPass ?? 0,
        evidencePostEnabled: execution.evidencePostEnabled,
      },
      contextAllowlist: [
        'workItem.title',
        'workItem.body',
        'workItem.number',
        'workItem.priority',
        'worktreePath',
        'stack.testCommand',
        'stack.lintCommand',
        'stack.typecheckCommand',
        'advisorFeedback',
        'revisionPass',
        'evidencePostEnabled',
      ],
      freshContext: false,
      toolBundles: ['dev-tools'],
      toolExtras: [],
      budgets: execution.budgets,
      modelOverride: execution.modelOverride,
      personaId: input.personaId,
      outputJsonSchema: input.outputJsonSchema,
      appendSystemPrompt: input.appendSystemPrompt,
    },
  });
  return output;
}

export async function afterImplement(input: AfterImplementInput): Promise<void> {
  const { implementOutput, workItem, stateSource, projectId, runId, worktreePath } = input;

  // Orchestrator commits the builder's work before opening the PR (ADR 0031).
  // The implement skill writes files but no longer commits; this call stages
  // all changes and creates a single commit attributed to the workflow run.
  input.orchestratorCommitFn(
    worktreePath,
    `fix(#${workItem.externalId}): ${workItem.title.slice(0, 60)}`,
  );

  // Emit implement decision summaries (#206 pattern).
  reconcileDecisionSummaries(
    runId,
    projectId,
    workItem.id,
    'implement',
    implementOutput.decisionSummaries,
  );
  eventStore.appendEvent({
    projectId,
    workItemId: workItem.id,
    kind: 'agent.implement-complete',
    payload: {
      filesWritten: implementOutput.filesWritten.length,
      testsWritten: implementOutput.testsWritten.length,
      confidence: implementOutput.confidence,
      // #467 — preserved verbatim so QA's workflow can pull dev's targeted
      // test command + paths into its context as `devTestsRun` and bucket
      // full-suite failures as inside- vs outside-targeted.
      testsRun: implementOutput.testsRun,
    },
    runId,
  });

  // Step 5: open PR.
  const token = process.env.GITHUB_TOKEN ?? '';
  if (token.length === 0 && process.env.MOCK_OPEN_PR !== 'true') {
    throw new Error('GITHUB_TOKEN env var is required to open PR');
  }
  const repoRef = stateSource.repoRef;
  const branchName = `factory/${runId}`;
  const title = `M7.XX: ${workItem.title.slice(0, 50)}`;
  const body = buildPrBody({ workItem, implementOutput });

  const prResult = await input.openPRFn({
    worktreePath,
    repo: repoRef,
    issueNumber: Number(workItem.externalId),
    title,
    body,
    branchName,
    baseBranch: input.baseBranch,
    token,
  });

  eventStore.appendEvent({
    projectId,
    workItemId: workItem.id,
    kind: 'pr.opened',
    payload: {
      prNumber: prResult.prNumber,
      prUrl: prResult.prUrl,
      branch: prResult.branch,
      worktreePath,
      devRunId: runId,
    },
    runId,
  });

  await stateSource.comment(
    workItem.externalId,
    buildAgentComment(
      'Dev',
      'Complete',
      `PR #${prResult.prNumber} opened — transitioning to needs-qa`,
      [`PR: ${prResult.prUrl}`],
    ),
  );

  // Step 6: evidence-post wiring (#234) — best-effort.
  // Resolve the worktree HEAD to the real commit SHA so evidence-post pins
  // its raw URLs to an immutable ref (#233 SHA-pinning contract).
  const prHeadSha = input.resolveHeadShaFn(worktreePath);

  // Look up the BEFORE-state comment posted by playwright-repro during
  // investigation (type:bug only). Absent for feature/chore.
  const investigationEvents = eventStore.replay({ workItemId: workItem.id });
  const investigationComplete = [...investigationEvents]
    .reverse()
    .find((e) => e.kind === 'agent.investigation-complete');
  const beforeCommentUrl = (
    investigationComplete?.payload as { playwrightRepro?: { commentUrl?: string } } | undefined
  )?.playwrightRepro?.commentUrl;

  await runEvidencePost({
    workItem,
    projectId,
    runId,
    runtime: input.runtime,
    appendSystemPrompt: input.evidencePostPrompt,
    outputJsonSchema: input.evidencePostJsonSchema,
    prNumber: prResult.prNumber,
    prHeadSha,
    repoRef,
    evidenceSpecPath: implementOutput.evidenceSpecPath,
    beforeCommentUrl,
    worktreePath,
  });

  // Step 7: M8 path — route through QA before approval (factory:in-progress → factory:needs-qa)
  await stateSource.transitionState(workItem.externalId, 'factory:in-progress', 'factory:needs-qa');
  emitStateTransitionEvent({
    projectId,
    workItemId: workItem.id,
    from: 'factory:in-progress',
    to: 'factory:needs-qa',
    by: 'fix-issue',
    runId,
  });
}
