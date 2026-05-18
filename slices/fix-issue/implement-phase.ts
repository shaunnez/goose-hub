import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import {
  type InvestigationContext,
  latestInvestigationContext,
  pathsTouchInvestigationSurface,
  toolCallsTouchInvestigationSurface,
} from '@goose-hub/core/agent-runtime/investigation-context.js';
import type { ModelTier } from '@goose-hub/core/agent-runtime/models.js';
import { reconcileDecisionSummaries } from '@goose-hub/core/agent-runtime/reconcile-decisions.js';
import { selectRuntime } from '@goose-hub/core/agent-runtime/select-runtime.js';
import { resolveSkillRuntimeForProject } from '@goose-hub/core/agent-runtime/skill-runtime-resolver.js';
import { runWithEscalation } from '@goose-hub/core/agent-runtime/with-escalation.js';
import type { openPR } from '@goose-hub/core/connectors/github/open-pr.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import {
  emitSymbolIndexHintsUsedEvent,
  offeredHintsFromSymbolKeyFiles,
} from '@goose-hub/core/symbol-index/hints-used.js';
import type { SymbolKeyFileHint } from '@goose-hub/core/symbol-index/lookup.js';
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
  investigation?: InvestigationContext;
  surfaceGuardInvestigation?: InvestigationContext;
  symbolIndexKeyFiles?: SymbolKeyFileHint[];
  revisionPass?: 0 | 1;
}

export interface ImplementExecution {
  runtime: AgentRuntime;
  projectConfig: Awaited<ReturnType<typeof getProjectBySlug>>;
  budgets: ReturnType<typeof resolveSkillRuntimeForProject>['budgets'];
  modelOverride: string;
  selectedTier: ModelTier;
  selectionReason: string;
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
  evidenceRuntime?: AgentRuntime;
  evidencePostPrompt: string;
  evidencePostJsonSchema: Record<string, unknown>;
  resolveHeadShaFn: (worktreePath: string) => string;
  /** Orchestrator commits before openPR (ADR 0031 — builder no-commit rule). */
  orchestratorCommitFn: typeof orchestratorCommitAll;
}

export { latestInvestigationContext };

function appendWrongSurfaceGuardEvent(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  personaId?: string;
  investigation: InvestigationContext;
  reason: string;
  touchedPaths?: string[];
}): void {
  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'agent.wrong-surface-guard',
    payload: {
      runId: input.runId,
      skill: 'implement',
      reason: input.reason,
      expectedKeyFiles: input.investigation.keyFiles.map((f) => f.path),
      touchedPaths: input.touchedPaths ?? [],
      investigationRunId: input.investigation.investigationRunId ?? null,
    },
    runId: input.runId,
    personaId: input.personaId,
  });
}

export function emitWrongSurfaceGuardForRun(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  personaId?: string;
  investigation?: InvestigationContext;
}): void {
  if (input.investigation == null) return;
  const runEvents = eventStore.replay({ runId: input.runId });
  if (
    toolCallsTouchInvestigationSurface({ events: runEvents, investigation: input.investigation })
  ) {
    return;
  }
  appendWrongSurfaceGuardEvent({
    ...input,
    investigation: input.investigation,
    reason: 'tool-calls-missed-investigation-surface',
  });
}

export async function resolveImplementExecution(input: {
  projectId: string;
  workItem: WorkItem;
  injectedRuntime?: AgentRuntime;
}): Promise<ImplementExecution> {
  const projectConfig = await getProjectBySlug(input.projectId);
  const configRuntime = projectConfig?.agentConfig?.runtime ?? 'auto';
  const resolvedRuntime = resolveSkillRuntimeForProject({
    skill: 'implement',
    projectBudgets: projectConfig?.budgets,
    projectId: input.projectId,
    configRuntime,
    role: 'developer',
    allowHoldoutOverride: projectConfig?.agentConfig?.allowHoldoutOverride,
  });

  if (input.injectedRuntime != null) {
    return {
      runtime: input.injectedRuntime,
      projectConfig,
      budgets: resolvedRuntime.budgets,
      modelOverride: resolvedRuntime.modelOverride,
      selectedTier: resolvedRuntime.tier,
      selectionReason: resolvedRuntime.source,
    };
  }

  const runtime = selectRuntime({
    configRuntime,
    model: resolvedRuntime.modelOverride,
    skillProvider: resolvedRuntime.provider,
  });

  return {
    runtime,
    projectConfig,
    budgets: resolvedRuntime.budgets,
    modelOverride: resolvedRuntime.modelOverride,
    selectedTier: resolvedRuntime.tier,
    selectionReason: resolvedRuntime.source,
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
  if (input.investigation != null) {
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItem.id,
      kind: 'agent.investigation-context-injected',
      payload: {
        runId: input.runId,
        skill: 'implement',
        investigationRunId: input.investigation.investigationRunId ?? null,
        keyFiles: input.investigation.keyFiles.map((f) => f.path),
        keyFileCount: input.investigation.keyFiles.length,
        findingsChars: input.investigation.findings?.length ?? 0,
        openQuestionCount: input.investigation.openQuestions.length,
      },
      runId: input.runId,
      personaId: input.personaId,
    });
  }

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
        investigation: input.investigation,
        advisorFeedback: input.advisorFeedback,
        revisionPass: input.revisionPass ?? 0,
        evidencePostEnabled: execution.projectConfig?.evidencePostEnabled ?? true,
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
        'investigation',
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
  emitSymbolIndexHintsUsedEvent({
    projectId: input.projectId,
    workItemId: input.workItem.id,
    consumerSkill: 'implement',
    runId: input.runId,
    personaId: input.personaId,
    offeredHints: offeredHintsFromSymbolKeyFiles(input.symbolIndexKeyFiles ?? []),
    toolEvents: eventStore.replay({ runId: input.runId, kind: 'agent.tool-call' }),
    worktreePath: input.worktreePath,
    appendEvent: (event) => eventStore.appendEvent(event),
  });
  const touchedPaths = [
    ...output.filesWritten.map((f) => f.path),
    ...output.testsWritten.map((t) => t.path),
    ...output.testsRun.paths,
  ];
  const surfaceGuardInvestigation = input.surfaceGuardInvestigation ?? input.investigation;
  if (!pathsTouchInvestigationSurface(touchedPaths, surfaceGuardInvestigation)) {
    appendWrongSurfaceGuardEvent({
      projectId: input.projectId,
      workItemId: input.workItem.id,
      runId: input.runId,
      personaId: input.personaId,
      investigation: surfaceGuardInvestigation as InvestigationContext,
      reason: 'implement-output-missed-investigation-surface',
      touchedPaths,
    });
    throw new Error(
      `wrong surface guard: implement output did not touch investigated key files (${surfaceGuardInvestigation?.keyFiles
        .map((f) => f.path)
        .join(', ')})`,
    );
  }
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
      baseBranch: prResult.base,
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
    appendSystemPrompt: input.evidencePostPrompt,
    outputJsonSchema: input.evidencePostJsonSchema,
    prNumber: prResult.prNumber,
    prHeadSha,
    repoRef,
    evidenceSpecPath: implementOutput.evidenceSpecPath,
    beforeCommentUrl,
    worktreePath,
    evidenceRuntime: input.evidenceRuntime,
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
