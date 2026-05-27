import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin, posix as pathPosix } from 'node:path';
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
import {
  collectReportedRunTestFailures,
  collectWrittenTestVerificationFailures,
  formatWrittenTestVerificationFailure,
} from '@goose-hub/core/agent-runtime/test-verification-evidence.js';
import { runWithEscalation } from '@goose-hub/core/agent-runtime/with-escalation.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import {
  actionableQaItemsToFeedback,
  collectActionableQaItems,
} from '@goose-hub/core/qa/actionability.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { deriveObservedChangedFiles } from '@goose-hub/core/workspaces/observed-changes.js';
import {
  orchestratorCommitAll,
  orchestratorPushBranch,
} from '@goose-hub/core/workspaces/orchestrator-git.js';
import { collectScopeManifest } from '@goose-hub/core/workspaces/scope-manifest.js';
import { type ImplementOutput, ImplementSchema } from '@goose-hub/skills/implement/schema.js';

/** Maximum prior dev decision-summaries surfaced to the repair agent. */
const PRIOR_DECISION_LIMIT = 20;
/** Maximum prior changed-file paths surfaced. Keeps the prompt focused. */
const PRIOR_CHANGED_FILES_LIMIT = 30;

interface PriorDevDecision {
  kind: string;
  summary: string;
}

type FixFeedbackEvent = ReturnType<typeof eventStore.replay>[number];

function runIdsForRepair(events: FixFeedbackEvent[], runId: string): Set<string> {
  const ids = new Set([runId]);
  for (const event of events) {
    if (event.kind !== 'agent.retry-escalated') continue;
    const payload = event.payload as { runId?: unknown; retryRunId?: unknown };
    if (payload.runId === runId && typeof payload.retryRunId === 'string') {
      ids.add(payload.retryRunId);
    }
  }
  return ids;
}

function eventBelongsToRun(event: FixFeedbackEvent, runIds: Set<string>): boolean {
  if (typeof event.runId === 'string' && runIds.has(event.runId)) return true;
  const payload = event.payload as { runId?: unknown; retryRunId?: unknown };
  return (
    (typeof payload.runId === 'string' && runIds.has(payload.runId)) ||
    (typeof payload.retryRunId === 'string' && runIds.has(payload.retryRunId))
  );
}

function fixFeedbackAcceptanceFailure(input: {
  output: ImplementOutput;
  events: FixFeedbackEvent[];
  runId: string;
}): string | null {
  const runIds = runIdsForRepair(input.events, input.runId);
  const runEvents = input.events.filter((event) => eventBelongsToRun(event, runIds));
  if (!runEvents.some((event) => event.kind === 'agent.tool-call')) return null;

  const writtenTestPaths = [...new Set(input.output.testsWritten.map((test) => test.path))];
  const failedWrittenTests = collectWrittenTestVerificationFailures(runEvents, writtenTestPaths);
  const writtenFailureReason = formatWrittenTestVerificationFailure(failedWrittenTests);
  if (writtenFailureReason != null) return writtenFailureReason;

  const reportedRunPaths = [...new Set(input.output.testsRun.paths)];
  const failedReportedRuns = collectReportedRunTestFailures({
    events: runEvents,
    reportedRunPaths,
    writtenTestPaths,
  });
  if (failedReportedRuns.length > 0) {
    return `required run_tests did not pass for: ${failedReportedRuns.join(', ')}`;
  }

  return null;
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
  baselineRegressionComparisonImpl?: typeof compareRegressionAgainstBaseline;
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
  command?: string | null;
  output?: string | null;
  findings: Array<{ tier: string; severity: string; description: string; suggestion?: string }>;
};

type BaselineComparisonStatus = 'same-failures-on-base' | 'head-only-failure' | 'unavailable';

type BaselineComparisonResult = {
  status: BaselineComparisonStatus;
  feedback: string;
};

type BaselineComparisonInput = {
  payload: QaPayload;
  worktreePath: string;
  baseBranch?: string;
};

type QaPayload = {
  verdict?: string;
  overallScore?: number;
  threshold?: number;
  deterministic?: boolean;
  agentSkipped?: boolean;
  failureCategory?: string;
  reason?: string;
  failedTier?: number | string;
  // qa.verification-blocked payload uses string findings, while qa.completed
  // uses structured QA findings. Keep this union local to the source-failure
  // formatter instead of widening the shared skill schemas.
  findings?:
    | string[]
    | Array<{
        tier?: string;
        severity?: string;
        description: string;
        suggestion?: string;
        disposition?: 'fixed' | 'needs-fix' | 'out-of-scope' | 'follow-up';
        dispositionRef?: string;
      }>;
  criteriaResults?: Array<{
    criterionId: string;
    checkId: string;
    ac: string;
    command: string;
    passed: boolean;
    exitCode?: number | null;
    actual?: string;
    error?: string;
  }>;
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
  actionable: boolean;
  verificationInfrastructure?: boolean;
  baselineRedGlobal?: boolean;
  requiresBaselineComparison?: boolean;
  payload?: QaPayload;
  skipReason?: string;
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
function localIssueRef(ref: string | undefined): string | null {
  const match = ref?.trim().match(/^#?(\d+)$/);
  return match?.[1] != null ? match[1] : null;
}

async function verifiedFollowUpRefsForPayload(
  payload: QaPayload,
  stateSource: StateSource,
): Promise<Set<string>> {
  const refs = new Set<string>();
  for (const finding of structuredQaFindings(payload)) {
    if (finding.disposition !== 'follow-up') continue;
    const localId = localIssueRef(finding.dispositionRef);
    if (localId == null) continue;
    try {
      await stateSource.getItem(localId);
      refs.add(`#${localId}`);
    } catch {
      // Keep invalid follow-up refs actionable.
    }
  }
  return refs;
}

function structuredQaFindings(
  payload: QaPayload,
): NonNullable<Extract<QaPayload['findings'], Array<{ description: string }>>> {
  return Array.isArray(payload.findings) && typeof payload.findings[0] !== 'string'
    ? (payload.findings as NonNullable<
        Extract<QaPayload['findings'], Array<{ description: string }>>
      >)
    : [];
}

function isVerificationInfrastructurePayload(payload: QaPayload): boolean {
  return (
    payload.failureCategory === 'verification-infrastructure' ||
    (payload.deterministic === true &&
      payload.agentSkipped === true &&
      payload.failureCategory === 'orchestration')
  );
}

function formatVerificationBlockedFeedback(payload: QaPayload): string {
  const lines = [
    'QA verification blocked before product assertions could run.',
    `Failure category: ${payload.failureCategory ?? 'verification-infrastructure'}`,
  ];
  if (payload.failedTier != null) lines.push(`Failed tier: ${payload.failedTier}`);
  if (payload.reason != null) lines.push(`Reason: ${payload.reason}`);
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  for (const finding of findings.slice(0, 5)) {
    lines.push(`- ${typeof finding === 'string' ? finding : finding.description}`);
  }
  return lines.join('\n');
}

function formatRegressionUnrelatedFeedback(payload: QaPayload): string {
  const lines = [
    'QA regression suite failed outside the issue-specific implementation surface.',
    `Failure category: ${payload.failureCategory ?? 'regression-unrelated'}`,
    'Compare against base/main before deciding whether this belongs to the issue repair loop.',
  ];
  const regressionFindings = payload.tierResults?.regression?.findings ?? [];
  for (const finding of regressionFindings.slice(0, 5)) {
    lines.push(`- ${finding.description}`);
  }
  return lines.join('\n');
}

function hasPromptContractRegression(payload: QaPayload): boolean {
  const text = [
    ...(payload.findings ?? []).map((finding) =>
      typeof finding === 'string' ? finding : finding.description,
    ),
    ...(payload.tierResults?.regression?.findings ?? []).map((finding) => finding.description),
  ]
    .join('\n')
    .toLowerCase();
  return (
    text.includes('skills/implement/slice.test') &&
    (text.includes('implement prompt') || text.includes('prompt contract'))
  );
}

function formatPromptContractRegressionFeedback(payload: QaPayload): string {
  const lines = [
    'QA regression suite failed on a prompt-contract test rather than this issue-specific implementation surface.',
    'Failure category: prompt-contract-regression',
  ];
  const regressionFindings = payload.tierResults?.regression?.findings ?? [];
  for (const finding of regressionFindings.slice(0, 5)) {
    lines.push(`- ${finding.description}`);
  }
  return lines.join('\n');
}

function regressionCommandForPayload(payload: QaPayload): string | null {
  const command = payload.tierResults?.regression?.command;
  return typeof command === 'string' && command.trim().length > 0 ? command.trim() : null;
}

function regressionFailureDescriptions(payload: QaPayload): string[] {
  return (payload.tierResults?.regression?.findings ?? [])
    .map((finding) => finding.description)
    .filter((description) => description.trim().length > 0);
}

function normalizeFailureSignature(value: string): string {
  return value
    .toLowerCase()
    .replace(/^regression\s*\[[^\]]+\]:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function extractFailedTestLines(output: string): string[] {
  const failed: string[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.length > 240) continue;
    if (trimmed.includes('FAIL') || trimmed.includes('✗') || trimmed.includes('× ')) {
      failed.push(trimmed);
    }
  }
  return failed.slice(0, 20);
}

function signaturesOverlap(left: string, right: string): boolean {
  if (left.length === 0 || right.length === 0) return false;
  return left === right || left.includes(right) || right.includes(left);
}

async function compareRegressionAgainstBaseline({
  payload,
  worktreePath,
  baseBranch = 'main',
}: BaselineComparisonInput): Promise<BaselineComparisonResult> {
  const command = regressionCommandForPayload(payload);
  if (command == null) {
    return {
      status: 'unavailable',
      feedback:
        'Baseline comparison unavailable: regression tier payload did not include a command.',
    };
  }

  const baselineDir = mkdtempSync(pathJoin(tmpdir(), 'goose-hub-baseline-'));
  const baseRef = baseBranch.startsWith('origin/') ? baseBranch : `origin/${baseBranch}`;
  try {
    const add = spawnSync(
      'git',
      ['-C', worktreePath, 'worktree', 'add', '--detach', baselineDir, baseRef],
      {
        encoding: 'utf8',
        timeout: 120_000,
      },
    );
    if (add.status !== 0) {
      return {
        status: 'unavailable',
        feedback: `Baseline comparison unavailable: could not create ${baseRef} worktree (${add.stderr || add.stdout || 'git worktree add failed'}).`,
      };
    }

    const run = spawnSync('sh', ['-c', command], {
      cwd: baselineDir,
      encoding: 'utf8',
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
      timeout: 10 * 60_000,
    });
    if (run.error != null) {
      return {
        status: 'unavailable',
        feedback: `Baseline comparison unavailable: ${run.error.message}.`,
      };
    }
    if ((run.status ?? 1) === 0) {
      return {
        status: 'head-only-failure',
        feedback: `Baseline comparison: ${command} passed on ${baseRef}; regression appears head-only.`,
      };
    }

    const baseOutput = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
    const baseFailures = extractFailedTestLines(baseOutput).map(normalizeFailureSignature);
    const headFailures = regressionFailureDescriptions(payload).map(normalizeFailureSignature);
    const sameFailures =
      baseFailures.length > 0 && headFailures.length > 0
        ? headFailures.some((head) => baseFailures.some((base) => signaturesOverlap(head, base)))
        : baseFailures.length > 0;

    if (sameFailures) {
      return {
        status: 'same-failures-on-base',
        feedback: `Baseline comparison: ${command} also failed on ${baseRef}; route as baseline-red/global instead of issue repair.`,
      };
    }

    return {
      status: 'head-only-failure',
      feedback: `Baseline comparison: ${command} failed on ${baseRef}, but not with the same failure signature; repair the head regression.`,
    };
  } finally {
    spawnSync('git', ['-C', worktreePath, 'worktree', 'remove', '--force', baselineDir], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    rmSync(baselineDir, { recursive: true, force: true });
  }
}

async function findLatestSourceFailure(
  events: ReturnType<typeof eventStore.replay>,
  stateSource: StateSource,
): Promise<SourceFailure | null> {
  let qaIdx = -1;
  let qaEvent: (typeof events)[number] | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (
      (e.kind === 'qa.completed' && (e.payload as QaPayload).verdict !== 'pass') ||
      e.kind === 'qa.verification-blocked'
    ) {
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
    return {
      kind: 'review',
      runId: sourceRunId(reviewEvent),
      feedback: lines.join('\n'),
      actionable: true,
    };
  }

  if (qaEvent != null) {
    const payload = qaEvent.payload as QaPayload;
    if (
      qaEvent.kind === 'qa.verification-blocked' ||
      isVerificationInfrastructurePayload(payload)
    ) {
      return {
        kind: 'qa',
        runId: sourceRunId(qaEvent),
        feedback: formatVerificationBlockedFeedback(payload),
        actionable: false,
        verificationInfrastructure: true,
        skipReason: 'verification-infrastructure',
      };
    }
    if (payload.failureCategory === 'regression-unrelated') {
      if (hasPromptContractRegression(payload)) {
        return {
          kind: 'qa',
          runId: sourceRunId(qaEvent),
          feedback: formatPromptContractRegressionFeedback(payload),
          actionable: false,
          baselineRedGlobal: true,
          skipReason: 'prompt-contract-regression',
          payload,
        };
      }
      return {
        kind: 'qa',
        runId: sourceRunId(qaEvent),
        feedback: formatRegressionUnrelatedFeedback(payload),
        actionable: false,
        requiresBaselineComparison: true,
        payload,
      };
    }
    const { verdict = 'fail', overallScore = 0, threshold = 70 } = payload;
    const verifiedFollowUpRefs = await verifiedFollowUpRefsForPayload(payload, stateSource);
    const actionableItems = collectActionableQaItems(
      { ...payload, findings: structuredQaFindings(payload) },
      { verifiedFollowUpRefs },
    );
    return {
      kind: 'qa',
      runId: sourceRunId(qaEvent),
      feedback:
        actionableItems.length > 0
          ? [
              `QA verdict: ${verdict} (score ${overallScore}/${threshold})`,
              '',
              actionableQaItemsToFeedback(actionableItems),
            ].join('\n')
          : '',
      actionable: actionableItems.length > 0,
    };
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
  let sourceFailure = await findLatestSourceFailure(events, stateSource);
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
  const compareRegressionFn =
    deps.baselineRegressionComparisonImpl ?? compareRegressionAgainstBaseline;
  const { runtime, resolvedBudget } = resolveProjectAgentExecution({
    skill: 'fix-feedback',
    role: 'developer',
    projectId,
    projectConfig,
    injectedRuntime: deps.runtime,
  });

  if (sourceFailure?.requiresBaselineComparison === true && sourceFailure.payload != null) {
    const worktreePath = prLifecycle?.worktreePath;
    if (worktreePath == null) {
      sourceFailure = {
        ...sourceFailure,
        baselineRedGlobal: true,
        skipReason: 'baseline-compare-unavailable',
        feedback: `${sourceFailure.feedback}\n\nBaseline comparison unavailable: no integration worktree was recorded.`,
      };
    } else {
      const comparison = await compareRegressionFn({
        payload: sourceFailure.payload,
        worktreePath,
        baseBranch: prLifecycle?.baseBranch,
      });
      if (comparison.status === 'head-only-failure') {
        sourceFailure = {
          ...sourceFailure,
          actionable: true,
          feedback: `${sourceFailure.feedback}\n\n${comparison.feedback}`,
        };
      } else {
        sourceFailure = {
          ...sourceFailure,
          baselineRedGlobal: true,
          skipReason:
            comparison.status === 'same-failures-on-base'
              ? 'baseline-red-global'
              : 'baseline-compare-unavailable',
          feedback: `${sourceFailure.feedback}\n\n${comparison.feedback}`,
        };
      }
    }
  }

  if (sourceFailure?.verificationInfrastructure === true) {
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment(
        'Dev',
        'Verification Blocked',
        'Skipping fix-feedback because QA failed in deterministic verification infrastructure before product assertions could run.',
        [sourceFailure.feedback],
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
      kind: 'agent.fix-feedback-skipped',
      payload: {
        ...repairPayload,
        reason: sourceFailure.skipReason ?? 'verification-infrastructure',
        sourceFeedback: sourceFailure.feedback,
      },
      runId,
    });
    return;
  }

  if (sourceFailure?.baselineRedGlobal === true) {
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment(
        'Dev',
        'Baseline Red',
        'Skipping fix-feedback because QA found regression-suite failures outside this issue-specific change.',
        [sourceFailure.feedback],
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
      kind: 'agent.fix-feedback-skipped',
      payload: {
        ...repairPayload,
        reason: sourceFailure.skipReason ?? 'baseline-red-global',
        sourceFeedback: sourceFailure.feedback,
      },
      runId,
    });
    return;
  }

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

  if (sourceFailure?.kind === 'qa' && !sourceFailure.actionable) {
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment(
        'Dev',
        'Complete',
        'No actionable QA findings remain — skipping fix-feedback and transitioning to needs-review',
      ),
    );
    await stateSource.transitionState(
      workItem.externalId,
      'factory:needs-fix',
      'factory:needs-review',
    );
    emitStateTransitionEvent({
      projectId,
      workItemId: workItem.id,
      from: 'factory:needs-fix',
      to: 'factory:needs-review',
      by: 'fix-feedback',
      runId,
      extraPayload: repairPayload,
    });
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.fix-feedback-skipped',
      payload: { ...repairPayload, reason: 'no-actionable-qa-findings' },
      runId,
    });
    return;
  }

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

    const acceptanceFailure = fixFeedbackAcceptanceFailure({
      output: implementOutput,
      events: eventStore.replay({ workItemId: workItem.id }),
      runId,
    });
    if (acceptanceFailure != null) {
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.run-failed',
        payload: {
          runId,
          error: `fix-feedback: ${acceptanceFailure}`,
          failureKind: 'verification-failed',
          ...repairPayload,
        },
        runId,
      });
      await stateSource.comment(
        workItem.externalId,
        buildAgentComment(
          'Dev',
          'Failed',
          `Fix-feedback verification failed: ${acceptanceFailure}`,
        ),
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
      return;
    }

    const observedChangedFiles = deriveObservedChangedFiles(worktreePath);
    const commitResult = commitAllFn(
      worktreePath,
      `fix(#${workItem.externalId}): address feedback cycle ${repairCycle}`,
    );
    if (commitResult.status === 'no-changes') {
      eventStore.appendEvent({
        projectId,
        workItemId: workItem.id,
        kind: 'agent.run-failed',
        payload: {
          runId,
          error: 'fix-feedback: implement produced no commit changes',
          ...repairPayload,
        },
        runId,
      });
      await stateSource.comment(
        workItem.externalId,
        buildAgentComment(
          'Dev',
          'Failed',
          'Fix-feedback produced no changes — escalating to needs-human',
        ),
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
      return;
    }
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
        commitSha: commitResult.sha,
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
