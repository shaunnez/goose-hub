import { posix as pathPosix } from 'node:path';
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { getChangedFilesSince } from '@goose-hub/core/agent-runtime/git-intel.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import {
  type InvestigationContext,
  latestInvestigationContext,
} from '@goose-hub/core/agent-runtime/investigation-context.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { reconcileDecisionSummaries } from '@goose-hub/core/agent-runtime/reconcile-decisions.js';
import { resolveProjectAgentExecution } from '@goose-hub/core/agent-runtime/resolve-runtime-for-project.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { runWithEscalation } from '@goose-hub/core/agent-runtime/with-escalation.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { deriveObservedChangedFiles } from '@goose-hub/core/workspaces/observed-changes.js';
import {
  orchestratorCommitAll,
  orchestratorPushBranch,
} from '@goose-hub/core/workspaces/orchestrator-git.js';
import { collectScopeManifest } from '@goose-hub/core/workspaces/scope-manifest.js';
import { ImplementSchema } from '@goose-hub/skills/implement/schema.js';

/** Maximum prior dev decision-summaries surfaced to the repair agent. */
const PRIOR_DECISION_LIMIT = 20;
/** Maximum prior changed-file paths surfaced. Keeps the prompt focused. */
const PRIOR_CHANGED_FILES_LIMIT = 30;

interface PriorDevDecision {
  kind: string;
  summary: string;
}

function collectPriorDevDecisions(
  events: ReturnType<typeof eventStore.replay>,
  prLifecycle: PrLifecycle | undefined,
): PriorDevDecision[] {
  const priorRunIds = [prLifecycle?.devRunId, prLifecycle?.pipelineRunId].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  if (priorRunIds.length === 0) return [];
  const out: PriorDevDecision[] = [];
  for (const event of events) {
    if (event.kind !== 'agent.decision-summary') continue;
    const payload = event.payload as { runId?: unknown; kind?: unknown; summary?: unknown } | null;
    if (payload == null) continue;
    const candidateRunId =
      typeof event.runId === 'string'
        ? event.runId
        : typeof payload.runId === 'string'
          ? payload.runId
          : undefined;
    if (
      candidateRunId == null ||
      !priorRunIds.some(
        (priorRunId) =>
          candidateRunId === priorRunId || candidateRunId.startsWith(`${priorRunId}:wp:`),
      )
    ) {
      continue;
    }
    if (typeof payload.kind !== 'string' || typeof payload.summary !== 'string') continue;
    out.push({ kind: payload.kind, summary: payload.summary });
    if (out.length >= PRIOR_DECISION_LIMIT) break;
  }
  return out;
}

function collectPriorChangedFiles(worktreePath: string, baseBranch?: string): string[] {
  try {
    return getChangedFilesSince(worktreePath, baseBranch).slice(0, PRIOR_CHANGED_FILES_LIMIT);
  } catch {
    return [];
  }
}

function buildPriorInvestigationPayload(investigation: InvestigationContext | undefined):
  | {
      findings?: string;
      keyFiles: string[];
      openQuestions: string[];
      investigationRunId?: string;
    }
  | undefined {
  if (investigation == null) return undefined;
  return {
    findings: investigation.findings,
    keyFiles: investigation.keyFiles.map((f) => f.path).filter((p) => p.length > 0),
    openQuestions: investigation.openQuestions,
    investigationRunId: investigation.investigationRunId,
  };
}

function deriveScopeRootsFromInvestigation(
  investigation: InvestigationContext | undefined,
): string[] {
  const roots = new Set<string>();
  for (const keyFile of investigation?.keyFiles ?? []) {
    if (keyFile.path.length === 0) continue;
    const dir = pathPosix.dirname(keyFile.path);
    if (dir.length > 0 && dir !== '.') roots.add(dir);
  }
  return [...roots];
}

export interface FixFeedbackDeps {
  runtime?: AgentRuntime;
  orchestratorCommitAllImpl?: typeof orchestratorCommitAll;
  orchestratorPushBranchImpl?: typeof orchestratorPushBranch;
}

/**
 * Finds the PR lifecycle identity from the most recent `pr.opened` event for this work item.
 * Returns undefined if no such event exists.
 */
function findPrLifecycle(events: ReturnType<typeof eventStore.replay>): PrLifecycle | undefined {
  const prOpened = events
    .slice()
    .reverse()
    .find((e) => e.kind === 'pr.opened');
  if (prOpened == null) return undefined;
  const payload = prOpened.payload as Record<string, unknown>;
  const rawPrNumber = payload.prNumber ?? payload.number;
  const devRunId = typeof payload.devRunId === 'string' ? payload.devRunId : undefined;
  const pipelineRunId =
    typeof payload.pipelineRunId === 'string' ? payload.pipelineRunId : undefined;
  const branch =
    typeof payload.branch === 'string'
      ? payload.branch
      : devRunId != null
        ? `factory/${devRunId}`
        : pipelineRunId != null
          ? `factory/${pipelineRunId}`
          : undefined;
  return {
    pipelineRunId,
    devRunId,
    worktreePath: typeof payload.worktreePath === 'string' ? payload.worktreePath : undefined,
    prNumber: typeof rawPrNumber === 'number' ? rawPrNumber : undefined,
    branch,
    baseBranch: typeof payload.baseBranch === 'string' ? payload.baseBranch : 'main',
    branchSource: typeof payload.branch === 'string' ? 'pr.opened' : 'fallback',
  };
}

type TierResult = {
  passed: boolean;
  findings: Array<{ tier: string; severity: string; description: string; suggestion?: string }>;
};

type QaPayload = {
  verdict?: string;
  overallScore?: number;
  threshold?: number;
  tierResults?: {
    structural?: TierResult;
    functional?: TierResult;
    regression?: TierResult;
  };
};

type ReviewPayload = {
  verdict?: string;
  findings?: Array<{ severity: string; description: string }>;
};

type PrLifecycle = {
  pipelineRunId?: string;
  devRunId?: string;
  worktreePath?: string;
  prNumber?: number;
  branch?: string;
  baseBranch?: string;
  branchSource: 'pr.opened' | 'fallback';
};

type SourceFailure = {
  kind: 'qa' | 'review';
  runId?: string;
  feedback: string;
};

function compactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function sourceRunId(event: ReturnType<typeof eventStore.replay>[number]): string | undefined {
  if (typeof event.runId === 'string') return event.runId;
  const payload = event.payload as { runId?: unknown } | null;
  return typeof payload?.runId === 'string' ? payload.runId : undefined;
}

function nextRepairCycle(events: ReturnType<typeof eventStore.replay>): number {
  const completedCycles = events.filter((event) => event.kind === 'agent.fix-feedback-complete');
  return completedCycles.length + 1;
}

/**
 * Scans events backward for the most recent `agent.implement-complete` or
 * `agent.fix-feedback-complete` event. If that event has a non-empty
 * `evidenceSpecPath`, returns it so the repair run can reuse the prior cycle's
 * spec. Otherwise, treats the missing path as an authoritative reset.
 */
function findPriorEvidenceSpecPath(events: ReturnType<typeof eventStore.replay>): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== 'agent.implement-complete' && e.kind !== 'agent.fix-feedback-complete') {
      continue;
    }
    const payload = e.payload as { evidenceSpecPath?: unknown };
    return typeof payload.evidenceSpecPath === 'string' && payload.evidenceSpecPath.length > 0
      ? payload.evidenceSpecPath
      : null;
  }
  return null;
}

/**
 * Finds the most recent failure from either `qa.completed` (non-pass) or
 * `review.completed` (needs-fix), whichever is later in the event stream,
 * and formats it as advisor feedback for the implement skill.
 *
 * Skips QA passes so a qa-fail → fix → qa-pass → review-fail cycle correctly
 * surfaces the review findings rather than the superseded QA pass.
 */
function findLatestSourceFailure(
  events: ReturnType<typeof eventStore.replay>,
): SourceFailure | null {
  let qaIdx = -1;
  let qaEvent: (typeof events)[number] | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'qa.completed' && (e.payload as QaPayload).verdict !== 'pass') {
      qaIdx = i;
      qaEvent = e;
      break;
    }
  }

  let reviewIdx = -1;
  let reviewEvent: (typeof events)[number] | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === 'review.completed' && (e.payload as ReviewPayload).verdict === 'needs-fix') {
      reviewIdx = i;
      reviewEvent = e;
      break;
    }
  }

  if (reviewEvent != null && reviewIdx > qaIdx) {
    const payload = reviewEvent.payload as ReviewPayload;
    const findings = payload.findings ?? [];
    const lines: string[] = ['Review verdict: needs-fix', '', 'Findings to address:'];
    for (const f of findings) {
      lines.push(`- [${f.severity}] ${f.description}`);
    }
    return { kind: 'review', runId: sourceRunId(reviewEvent), feedback: lines.join('\n') };
  }

  if (qaEvent != null) {
    const payload = qaEvent.payload as QaPayload;
    const { verdict = 'fail', overallScore = 0, threshold = 70, tierResults = {} } = payload;
    const lines: string[] = [
      `QA verdict: ${verdict} (score ${overallScore}/${threshold})`,
      '',
      'Findings to address:',
    ];
    for (const [tier, result] of Object.entries(tierResults) as [
      string,
      TierResult | undefined,
    ][]) {
      if (result == null || result.passed) continue;
      for (const f of result.findings) {
        lines.push(
          `- [${tier}/${f.severity}] ${f.description}${f.suggestion ? ` — ${f.suggestion}` : ''}`,
        );
      }
    }
    return { kind: 'qa', runId: sourceRunId(qaEvent), feedback: lines.join('\n') };
  }

  return null;
}

/**
 * Runs the fix-feedback workflow for a work item in `factory:needs-fix` state.
 *
 * This workflow is invoked after QA fails and auto-transition has moved the
 * item from `factory:qa-failed` → `factory:needs-fix`. It differs from
 * fix-issue in that:
 * - It reuses the existing worktree (no new worktree created)
 * - It injects QA findings as `advisorFeedback` for the implement skill
 * - It pushes to the existing branch (no new PR opened)
 *
 * Sequence:
 *   1. Find existing worktree from `pr.opened` event → missing = needs-human
 *   2. Transition factory:needs-fix → factory:in-progress
 *   3. Run implement skill with QA findings as advisorFeedback, revisionPass=1
 *   4. Emit agent.fix-feedback-complete
 *   5. Transition factory:in-progress → factory:needs-qa
 *
 * On failure at any step: comment, transition to factory:needs-human.
 */
export async function runFixFeedbackWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  projectId: string,
  _targetRepo: string,
  deps: FixFeedbackDeps = {},
): Promise<void> {
  const runId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const events = eventStore.replay({ workItemId: workItem.id });
  const prLifecycle = findPrLifecycle(events);
  const sourceFailure = findLatestSourceFailure(events);
  const repairCycle = nextRepairCycle(events);
  const repairPayload = compactPayload({
    pipelineRunId: prLifecycle?.pipelineRunId,
    attemptId,
    repairMode: 'legacy-implement',
    repairCycle,
    sourceFailureKind: sourceFailure?.kind,
    sourceFailureRunId: sourceFailure?.runId,
    worktreePath: prLifecycle?.worktreePath,
    prNumber: prLifecycle?.prNumber,
    devRunId: prLifecycle?.devRunId,
    branch: prLifecycle?.branch,
    baseBranch: prLifecycle?.baseBranch,
    branchSource: prLifecycle?.branchSource,
  });
  const projectConfig = await getProjectBySlug(projectId);
  const commitAllFn = deps.orchestratorCommitAllImpl ?? orchestratorCommitAll;
  const pushBranchFn = deps.orchestratorPushBranchImpl ?? orchestratorPushBranch;
  const { runtime, resolvedBudget } = resolveProjectAgentExecution({
    skill: 'implement',
    role: 'developer',
    projectId,
    projectConfig,
    injectedRuntime: deps.runtime,
  });

  const worktreePath = prLifecycle?.worktreePath;
  if (worktreePath == null) {
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment(
        'Dev',
        'Failed',
        'No worktree found — cannot locate existing dev workspace, escalating to needs-human',
      ),
    );
    await stateSource.transitionState(
      workItem.externalId,
      'factory:needs-fix',
      'factory:needs-human',
    );
    emitStateTransitionEvent({
      projectId,
      workItemId: workItem.id,
      from: 'factory:needs-fix',
      to: 'factory:needs-human',
      by: 'fix-feedback',
      runId,
      extraPayload: repairPayload,
    });
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: {
        runId,
        error: 'fix-feedback: no worktree found in pr.opened events',
        ...repairPayload,
      },
      runId,
    });
    return;
  }
  const branch = prLifecycle?.branch;
  if (branch == null) {
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment(
        'Dev',
        'Failed',
        'No PR branch found — cannot push repair commit, escalating to needs-human',
      ),
    );
    await stateSource.transitionState(
      workItem.externalId,
      'factory:needs-fix',
      'factory:needs-human',
    );
    emitStateTransitionEvent({
      projectId,
      workItemId: workItem.id,
      from: 'factory:needs-fix',
      to: 'factory:needs-human',
      by: 'fix-feedback',
      runId,
      extraPayload: repairPayload,
    });
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: {
        runId,
        error: 'fix-feedback: no branch found in pr.opened events',
        ...repairPayload,
      },
      runId,
    });
    return;
  }

  const implementPrompt = readPromptWithContext('implement', projectId);
  const implementJsonSchema = toJsonSchema(ImplementSchema);
  const { personaId } = selectPersona(projectId, 'developer');
  const advisorFeedback = sourceFailure?.feedback ?? '';

  const priorInvestigation = latestInvestigationContext({
    projectId,
    workItemId: workItem.id,
    worktreePath,
  });
  const priorInvestigationPayload = buildPriorInvestigationPayload(priorInvestigation);
  const existingFileManifest = collectScopeManifest(
    worktreePath,
    deriveScopeRootsFromInvestigation(priorInvestigation),
  );
  const priorDevDecisions = collectPriorDevDecisions(events, prLifecycle);
  const priorDevChangedFiles = collectPriorChangedFiles(worktreePath, prLifecycle?.baseBranch);
  const priorEvidenceSpecPath = findPriorEvidenceSpecPath(events) ?? undefined;

  await stateSource.transitionState(
    workItem.externalId,
    'factory:needs-fix',
    'factory:in-progress',
  );
  emitStateTransitionEvent({
    projectId,
    workItemId: workItem.id,
    from: 'factory:needs-fix',
    to: 'factory:in-progress',
    by: 'fix-feedback',
    runId,
    extraPayload: repairPayload,
  });

  if (priorInvestigationPayload != null || priorDevChangedFiles.length > 0) {
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.investigation-context-injected',
      payload: {
        runId,
        skill: 'fix-feedback',
        investigationRunId: priorInvestigationPayload?.investigationRunId ?? null,
        keyFiles: priorInvestigationPayload?.keyFiles ?? [],
        keyFileCount: priorInvestigationPayload?.keyFiles.length ?? 0,
        findingsChars: priorInvestigationPayload?.findings?.length ?? 0,
        openQuestionCount: priorInvestigationPayload?.openQuestions.length ?? 0,
        priorDevRunId: prLifecycle?.devRunId ?? null,
        priorDevDecisionCount: priorDevDecisions.length,
        priorDevChangedFileCount: priorDevChangedFiles.length,
      },
      runId,
      personaId,
    });
  }

  try {
    const { output: implementOutput } = await runWithEscalation({
      runtime,
      schema: ImplementSchema,
      projectId,
      workItemId: workItem.id,
      projectBudgets: projectConfig?.budgets,
      spec: {
        runId,
        role: 'developer',
        skill: 'implement',
        workspaceDir: worktreePath,
        context: {
          projectId,
          workItemId: workItem.id,
          workItem: {
            title: workItem.title,
            body: workItem.body,
            number: Number(workItem.externalId),
            priority: workItem.priority,
          },
          stack: {
            testCommand: 'pnpm test',
            lintCommand: 'pnpm lint',
            typecheckCommand: 'pnpm typecheck',
          },
          advisorFeedback: advisorFeedback || undefined,
          revisionPass: 1,
          priorEvidenceSpecPath,
          existingFileManifest: existingFileManifest.length > 0 ? existingFileManifest : undefined,
          priorInvestigation: priorInvestigationPayload,
          priorDevDecisions: priorDevDecisions.length > 0 ? priorDevDecisions : undefined,
          priorDevChangedFiles: priorDevChangedFiles.length > 0 ? priorDevChangedFiles : undefined,
        },
        contextAllowlist: [
          'workItem.title',
          'workItem.body',
          'workItem.number',
          'workItem.priority',
          'stack.testCommand',
          'stack.lintCommand',
          'stack.typecheckCommand',
          'advisorFeedback',
          'revisionPass',
          'priorEvidenceSpecPath',
          'existingFileManifest',
          'priorInvestigation.findings',
          'priorInvestigation.keyFiles',
          'priorInvestigation.openQuestions',
          'priorDevDecisions',
          'priorDevChangedFiles',
        ],
        freshContext: false,
        toolBundles: ['dev-tools'],
        toolExtras: [],
        ...resolvedBudget,
        personaId,
        extraEventPayload: {
          displaySkill: 'fix-feedback',
          workflowSkill: 'fix-feedback',
        },
        outputJsonSchema: implementJsonSchema,
        appendSystemPrompt: implementPrompt,
      },
    });

    const observedChangedFiles = deriveObservedChangedFiles(worktreePath);
    const commitSha = commitAllFn(
      worktreePath,
      `fix(#${workItem.externalId}): address feedback cycle ${repairCycle}`,
    );
    pushBranchFn(worktreePath, branch);

    reconcileDecisionSummaries(
      runId,
      projectId,
      workItem.id,
      'fix-feedback',
      implementOutput.decisionSummaries,
    );

    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.fix-feedback-complete',
      payload: {
        ...repairPayload,
        commitSha,
        filesWritten: implementOutput.filesWritten.length,
        testsWritten: implementOutput.testsWritten.length,
        confidence: implementOutput.confidence,
        testsRun: implementOutput.testsRun,
        evidenceSpecPath: implementOutput.evidenceSpecPath,
        observedChangedFiles: {
          count: observedChangedFiles.count,
          paths: observedChangedFiles.paths,
        },
      },
      runId,
    });

    accumulatePersonaStats({ personaName: personaId, role: 'developer', outcome: 'success' });

    await stateSource.comment(
      workItem.externalId,
      buildAgentComment('Dev', 'Complete', 'Fix-feedback applied — transitioning to needs-qa'),
    );
    await stateSource.transitionState(
      workItem.externalId,
      'factory:in-progress',
      'factory:needs-qa',
    );
    emitStateTransitionEvent({
      projectId,
      workItemId: workItem.id,
      from: 'factory:in-progress',
      to: 'factory:needs-qa',
      by: 'fix-feedback',
      runId,
      extraPayload: repairPayload,
    });
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'developer', outcome: 'failure' });
    const error = err instanceof Error ? err : new Error(String(err));
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { runId, error: error.message, ...repairPayload },
      runId,
    });
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment('Dev', 'Failed', 'Fix-feedback failed — escalating to needs-human', [
        `Error: ${error.message}`,
      ]),
    );
    await stateSource.transitionState(
      workItem.externalId,
      'factory:in-progress',
      'factory:needs-human',
    );
    emitStateTransitionEvent({
      projectId,
      workItemId: workItem.id,
      from: 'factory:in-progress',
      to: 'factory:needs-human',
      by: 'fix-feedback',
      runId,
      extraPayload: repairPayload,
    });
  }
}
