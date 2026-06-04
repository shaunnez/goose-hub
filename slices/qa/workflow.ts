import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AcceptanceContract } from '@goose-hub/core/acceptance-contracts/types.js';
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { preparePrDiffContext } from '@goose-hub/core/agent-runtime/dev-review-advisor.js';
import { findFreePort } from '@goose-hub/core/agent-runtime/find-free-port.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { safeParseOutputForSchema } from '@goose-hub/core/agent-runtime/output-normalization.js';
import { buildPrDiffWithContext } from '@goose-hub/core/agent-runtime/pr-diff-context.js';
import { killProcessGroupOrChild } from '@goose-hub/core/agent-runtime/process-kill.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { reconcileDecisionSummaries } from '@goose-hub/core/agent-runtime/reconcile-decisions.js';
import { resolveProjectAgentExecution } from '@goose-hub/core/agent-runtime/resolve-runtime-for-project.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { type QaE2eMode, getQaE2eMode } from '@goose-hub/core/db/repositories/project-settings.js';
import { getEngineeringSpec as defaultGetEngineeringSpec } from '@goose-hub/core/engineering-specs/repository.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import {
  classifyQaFailureActionability,
  collectActionableQaItems,
} from '@goose-hub/core/qa/actionability.js';
import { classifyQaFailure } from '@goose-hub/core/qa/failure-category.js';
import { DEFAULT_MAX_RETRIES, shouldEscalateQa } from '@goose-hub/core/retry/retry-counter.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { parseVitestJson } from '@goose-hub/core/test-runner/parse-vitest-json.js';
import type { RegressionPolicy, TierResult } from '@goose-hub/core/verify/tiers.js';
import { runTier as defaultRunTier } from '@goose-hub/core/verify/tiers.js';
import {
  type CriteriaResult,
  CriteriaResultSchema,
  type QaOutput,
  QaOutputSchema,
  type TestRun,
  type VerificationSummary,
} from '@goose-hub/skills/qa/schema.js';
import type { EngineeringSpec } from '@goose-hub/skills/spec-author/schema.js';
import {
  type DeterministicVerifyOutcome,
  type VerifyCommand,
  defaultRunTests,
  detectTierDisagreement,
  runDeterministicTiers,
  toAgentTierResults,
} from './deterministic-tiers.js';
export type { VerifyCommand } from './deterministic-tiers.js';
import { findDevTestsRun, findPrOpenedHints, getPrDiff } from './qa-helpers.js';
import { buildSyntheticQaOutput } from './synthetic-output.js';
import {
  type RunQaCommand,
  buildVerificationSummary,
  estimateVerificationSummaryBytes,
} from './verification-summary.js';

export interface QaWorkflowDeps {
  runtime?: AgentRuntime;
  /**
   * Override for the test runner. Default uses `runVitest` against the
   * configured test command. Pass a stub in tests to avoid spawning.
   * Returning `null` (or throwing) is treated as "no testRun data" — the
   * QA agent still runs, just without real suite numbers in its context.
   */
  runTests?: (cwd: string, command: string) => Promise<TestRun | null>;
  /** Inject for tests — run compact lint/typecheck command summaries. */
  runCommand?: RunQaCommand;
  /** Executable AC checks resolved before QA spawn. */
  executableChecks?: VerifyCommand[];
  /** Resolved acceptance contract from normalized event/spec/PRD/issue body. */
  acceptanceContract?: AcceptanceContract;
  /** Inject for tests — return the spec for this work item, or null. */
  getEngineeringSpecImpl?: typeof defaultGetEngineeringSpec;
  /** Inject for tests — run a single deterministic verify tier. */
  runTierImpl?: typeof defaultRunTier;
}

const DEFAULT_TEST_COMMAND = 'pnpm test --reporter=json';
const EXECUTABLE_CHECK_OUTPUT_LIMIT = 4_000;
const QA_CONTEXT_CRITERIA_OUTPUT_LIMIT = 1_000;
const QA_CONTEXT_VALUE_LIMIT_BYTES = 60_000;
const QA_CONTEXT_STRING_PREVIEW_CHARS = 4_000;

function localIssueRef(ref: string | undefined): string | null {
  const match = ref?.trim().match(/^#?(\d+)$/);
  return match?.[1] != null ? match[1] : null;
}

function estimateJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function compactLargeQaContextValue(key: string, value: unknown): unknown {
  const byteSize = estimateJsonBytes(value);
  if (byteSize <= QA_CONTEXT_VALUE_LIMIT_BYTES) return value;

  if (typeof value === 'string') {
    return {
      omitted: true,
      reason: 'qa-context-value-too-large',
      key,
      byteSize,
      preview: value.slice(0, QA_CONTEXT_STRING_PREVIEW_CHARS),
    };
  }

  if (key === 'workItem' && value != null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return {
      ...record,
      body:
        typeof record.body === 'string'
          ? record.body.slice(0, QA_CONTEXT_STRING_PREVIEW_CHARS)
          : record.body,
      bodyTruncated: typeof record.body === 'string',
      originalByteSize: byteSize,
    };
  }

  if (key === 'acceptanceContract' && value != null && typeof value === 'object') {
    const record = value as { criteria?: unknown };
    return {
      omitted: true,
      reason: 'qa-context-value-too-large',
      key,
      byteSize,
      criteriaCount: Array.isArray(record.criteria) ? record.criteria.length : undefined,
    };
  }

  return {
    omitted: true,
    reason: 'qa-context-value-too-large',
    key,
    byteSize,
  };
}

function compactQaContextForPrompt(context: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, compactLargeQaContextValue(key, value)]),
  );
}

function hasUiChangedPath(paths: readonly string[]): boolean {
  return paths.some((path) => path.startsWith('apps/web/'));
}

function explicitEvidenceSkipReason(summary: VerificationSummary): string {
  return hasUiChangedPath(summary.changedFiles.paths)
    ? 'no evidence workflow event was recorded for UI changes; browser evidence did not run or no evidence spec was declared'
    : 'non-UI change; browser evidence not required';
}

function ensureExplicitEvidenceSummary(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  summary: VerificationSummary;
}): VerificationSummary {
  if (input.summary.evidence.status !== 'absent') return input.summary;
  const reason = explicitEvidenceSkipReason(input.summary);
  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId,
    kind: 'evidence.post-skipped',
    payload: {
      runId: input.runId,
      reason,
      source: 'qa',
      changedPaths: input.summary.changedFiles.paths,
    },
    runId: input.runId,
  });
  return {
    ...input.summary,
    evidence: {
      status: 'skipped',
      reason,
    },
  };
}

async function verifiedFollowUpRefsForQaOutput(
  qaOutput: QaOutput,
  stateSource: StateSource,
): Promise<Set<string>> {
  const refs = new Set<string>();
  for (const finding of qaOutput.findings) {
    if (finding.disposition !== 'follow-up') continue;
    const localId = localIssueRef(finding.dispositionRef);
    if (localId == null) continue;
    try {
      await stateSource.getItem(localId);
      refs.add(`#${localId}`);
    } catch {
      // Invalid follow-up refs remain unverified and become actionable.
    }
  }
  return refs;
}

function isVerifiedFollowUp(
  finding: QaOutput['findings'][number],
  verifiedRefs: ReadonlySet<string>,
) {
  const localId = localIssueRef(finding.dispositionRef);
  return localId != null && verifiedRefs.has(`#${localId}`);
}

function isNonBlockingQaFinding(
  finding: QaOutput['findings'][number],
  verifiedFollowUpRefs: ReadonlySet<string>,
): boolean {
  if (finding.disposition === 'out-of-scope' || finding.disposition === 'fixed') return true;
  return finding.disposition === 'follow-up' && isVerifiedFollowUp(finding, verifiedFollowUpRefs);
}

function failVerdictHasOnlyNonBlockingFindings(
  qaOutput: QaOutput,
  verifiedFollowUpRefs: ReadonlySet<string>,
): boolean {
  return (
    qaOutput.findings.length > 0 &&
    qaOutput.findings.every((finding) => isNonBlockingQaFinding(finding, verifiedFollowUpRefs))
  );
}

function classifyVerificationInfrastructureFailure(
  result: TierResult | null,
): { reason: string; findings: string[] } | null {
  if (result == null || result.passed) return null;
  const infrastructureFindings = result.findings.filter((finding) => {
    if (finding.category === 'verification-infrastructure') return true;
    const detail = `${finding.code ?? ''}\n${finding.message}`.toLowerCase();
    return (
      detail.includes('malformed verification command') ||
      detail.includes('permission denied') ||
      detail.includes('eacces') ||
      detail.includes('command not found') ||
      detail.includes('verification-runner-missing') ||
      detail.includes('verification-harness-config') ||
      detail.includes('no test files found') ||
      detail.includes('missing script') ||
      detail.includes('failed to load config')
    );
  });
  if (infrastructureFindings.length === 0) return null;
  return {
    reason: infrastructureFindings[0]?.code ?? 'verification-infrastructure-failure',
    findings: infrastructureFindings.map((finding) => finding.message),
  };
}

type CriteriaEvidenceArtifact = NonNullable<CriteriaResult['evidenceArtifact']>;

function processEvidenceArtifact(): CriteriaEvidenceArtifact {
  return {
    type: 'process',
    summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
    matchedSuites: [],
    matchedTests: [],
    artifactStatus: 'unavailable',
  };
}

function vitestEvidenceArtifact(
  rawOutput: string,
  expectation: Extract<VerifyCommand['evidenceExpectation'], { type: 'vitest-json' }>,
): CriteriaEvidenceArtifact {
  try {
    const testRun = parseVitestJson(JSON.parse(rawOutput.trim()));
    const suites =
      expectation.suite == null
        ? testRun.suites
        : testRun.suites.filter(
            (suite) =>
              suite.name === expectation.suite ||
              suite.filePath.endsWith(expectation.suite ?? '__never__'),
          );
    const matchedTests =
      expectation.testName == null
        ? []
        : suites.flatMap((suite) =>
            (suite.tests ?? [])
              .filter(
                (test) =>
                  test.name === expectation.testName && test.status === expectation.expectedStatus,
              )
              .map((test) => test.name),
          );
    const suiteMatched = expectation.suite == null || suites.length > 0;
    const testMatched = expectation.testName == null || matchedTests.length > 0;
    const suiteStatusMatched =
      expectation.testName != null
        ? true
        : expectation.suite == null
          ? testRun.success
          : suites.some((suite) => suite.status === expectation.expectedStatus);
    return {
      type: 'vitest-json',
      summary: {
        total: testRun.total,
        passed: testRun.passed,
        failed: testRun.failed,
        skipped: testRun.skipped,
      },
      matchedSuites: suites.map((suite) => suite.name),
      matchedTests,
      artifactStatus: suiteMatched && testMatched && suiteStatusMatched ? 'matched' : 'not-found',
    };
  } catch {
    return {
      type: 'vitest-json',
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
      matchedSuites: [],
      matchedTests: [],
      artifactStatus: 'unavailable',
    };
  }
}

function evidenceArtifactFor(
  actual: string,
  expectation: VerifyCommand['evidenceExpectation'],
): CriteriaEvidenceArtifact {
  if (expectation?.type === 'vitest-json') return vitestEvidenceArtifact(actual, expectation);
  return processEvidenceArtifact();
}

function evidenceExpectationPassed(artifact: CriteriaEvidenceArtifact): boolean {
  if (artifact.type === 'vitest-json') return artifact.artifactStatus === 'matched';
  return true;
}

async function runExecutableCheck(input: {
  cwd: string;
  check: VerifyCommand;
  env?: NodeJS.ProcessEnv;
  defaultTimeoutMs: number;
}): Promise<CriteriaResult> {
  const expectedExitCodes =
    input.check.expectedExitCodes.length > 0 ? input.check.expectedExitCodes : [0];
  const timeoutMs = input.check.timeoutMs ?? input.defaultTimeoutMs;
  const started = Date.now();
  return await new Promise((resolve) => {
    let settled = false;
    let fullOutput = '';
    const appendOutput = (chunk: Buffer | string) => {
      fullOutput = `${fullOutput}${chunk.toString()}`;
    };
    const actualOutput = () => fullOutput.slice(-EXECUTABLE_CHECK_OUTPUT_LIMIT);
    const finish = (result: Omit<CriteriaResult, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ...result, durationMs: Date.now() - started });
    };
    const child = spawn('sh', ['-c', input.check.command], {
      cwd: input.cwd,
      detached: process.platform !== 'win32',
      env: { ...process.env, CI: 'true', ...input.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timeout = setTimeout(() => {
      killProcessGroupOrChild(child);
      finish({
        criterionId: input.check.criterionId,
        checkId: input.check.checkId,
        ac: input.check.ac,
        command: input.check.command,
        expectedExitCodes,
        exitCode: null,
        actual: actualOutput(),
        passed: false,
        evidenceArtifact: processEvidenceArtifact(),
        ...(input.check.outputExpectation != null
          ? { outputExpectation: input.check.outputExpectation }
          : {}),
        error: `command timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer | string) => {
      appendOutput(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      appendOutput(chunk);
    });
    child.on('error', (err) => {
      finish({
        criterionId: input.check.criterionId,
        checkId: input.check.checkId,
        ac: input.check.ac,
        command: input.check.command,
        expectedExitCodes,
        exitCode: null,
        actual: actualOutput(),
        passed: false,
        evidenceArtifact: processEvidenceArtifact(),
        ...(input.check.outputExpectation != null
          ? { outputExpectation: input.check.outputExpectation }
          : {}),
        error: err.message,
      });
    });
    child.on('close', (code) => {
      const exitCode = code ?? 1;
      const evidenceArtifact = evidenceArtifactFor(fullOutput, input.check.evidenceExpectation);
      const exitCodePassed = expectedExitCodes.includes(exitCode);
      finish({
        criterionId: input.check.criterionId,
        checkId: input.check.checkId,
        ac: input.check.ac,
        command: input.check.command,
        expectedExitCodes,
        exitCode,
        actual: actualOutput(),
        passed: exitCodePassed && evidenceExpectationPassed(evidenceArtifact),
        ...(input.check.outputExpectation != null
          ? { outputExpectation: input.check.outputExpectation }
          : {}),
        ...(input.check.evidenceExpectation != null
          ? { evidenceExpectation: input.check.evidenceExpectation }
          : {}),
        evidenceArtifact,
      });
    });
  });
}

async function runExecutableChecks(input: {
  workspaceDir?: string;
  checks?: VerifyCommand[];
  env?: NodeJS.ProcessEnv;
  defaultTimeoutMs: number;
}): Promise<CriteriaResult[]> {
  if (input.checks == null || input.checks.length === 0) return [];
  if (input.workspaceDir == null) {
    return input.checks.map((check) => ({
      criterionId: check.criterionId,
      checkId: check.checkId,
      ac: check.ac,
      command: check.command,
      expectedExitCodes: check.expectedExitCodes.length > 0 ? check.expectedExitCodes : [0],
      exitCode: null,
      actual: '',
      passed: false,
      evidenceArtifact: processEvidenceArtifact(),
      ...(check.outputExpectation != null ? { outputExpectation: check.outputExpectation } : {}),
      error: 'workspaceDir unavailable; executable check was not run',
    }));
  }
  const results: CriteriaResult[] = [];
  for (const check of input.checks) {
    results.push(
      await runExecutableCheck({
        cwd: input.workspaceDir,
        check,
        env: input.env,
        defaultTimeoutMs: input.defaultTimeoutMs,
      }),
    );
  }
  return results;
}

function compactCriteriaResultsForQaContext(results: CriteriaResult[]): CriteriaResult[] {
  return results.map((result) => ({
    ...result,
    actual:
      result.actual.length > QA_CONTEXT_CRITERIA_OUTPUT_LIMIT
        ? result.actual.slice(-QA_CONTEXT_CRITERIA_OUTPUT_LIMIT)
        : result.actual,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function restoreWorkflowOwnedCriteriaResults(input: {
  output: unknown;
  criteriaResults: CriteriaResult[];
  contextCriteriaResults: CriteriaResult[];
}): {
  output: unknown;
  warning?: {
    reason: 'invalid-agent-copy' | 'changed-agent-copy';
    issues?: unknown;
  };
} {
  if (input.criteriaResults.length === 0 || !isRecord(input.output)) {
    return { output: input.output };
  }

  const suppliedCriteriaResults = input.output.criteriaResults;
  const output = { ...input.output, criteriaResults: input.criteriaResults };
  if (suppliedCriteriaResults == null) return { output };

  const parsed = safeParseOutputForSchema(CriteriaResultSchema.array(), suppliedCriteriaResults);
  if (!parsed.success) {
    return {
      output,
      warning: {
        reason: 'invalid-agent-copy',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      },
    };
  }

  if (JSON.stringify(parsed.data) !== JSON.stringify(input.contextCriteriaResults)) {
    return { output, warning: { reason: 'changed-agent-copy' } };
  }

  return { output };
}

/**
 * Runs the QA holdout workflow for a work item in `factory:needs-qa` state.
 * QA is a holdout: fresh context, no advisor, no fallback (FACTORY_RULES 1, 20, 23).
 *
 * Workflow (M19.19):
 * 1. Snapshot existing events (for retry counting — read BEFORE appending outcome)
 * 2. If an engineering spec is on file AND a worktree is available, run the
 *    deterministic 3-tier verify (`core/verify/tiers.ts`) FIRST.
 *    a. Tier 1/2 fail, or Tier 3 fail with `regressionPolicy === 'escalate'`,
 *       short-circuits: synthesize a `qa.completed` event from ground truth,
 *       skip the QA agent, route via the existing retry-counter
 *       (`factory:qa-failed`, escalating to `factory:needs-human` once retries
 *       are exhausted).
 *    b. Tier 3 fail with `regressionPolicy === 'ignore'` continues to the
 *       agent with the tier 3 result tagged as a warning.
 * 3. When tiers all pass (or are skipped), invoke the QA agent with
 *    `deterministicTierResults` in context.
 * 4. After parse, reject any tier-result disagreement — emit
 *    `qa.tier-disagreement` and route to `factory:needs-human`.
 * 5. Emit `qa.completed` using deterministic tier results as ground truth
 *    where they exist; the agent's other fields (qualityScores, findings,
 *    verdict, etc.) ride along.
 *
 * On runtime error: emit agent.run-failed, comment, transition to factory:needs-human.
 */
export async function runQaWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  projectSlug: string,
  _targetRepo: string,
  deps: QaWorkflowDeps = {},
): Promise<void> {
  const runId = crypto.randomUUID();
  const runTests = deps.runTests ?? defaultRunTests;
  const runCommand = deps.runCommand;
  const executableChecks = deps.executableChecks;
  const acceptanceContract = deps.acceptanceContract;
  const getSpec = deps.getEngineeringSpecImpl ?? defaultGetEngineeringSpec;
  const runTier = deps.runTierImpl ?? defaultRunTier;
  const qaPrompt = readPromptWithContext('qa', projectSlug);
  const projectConfig = await getProjectBySlug(projectSlug);
  const { runtime, resolvedBudget } = resolveProjectAgentExecution({
    skill: 'qa',
    role: 'qa',
    projectId: projectSlug,
    projectConfig,
    injectedRuntime: deps.runtime,
  });
  const qaJsonSchema = toJsonSchema(QaOutputSchema);
  const { personaId } = selectPersona(projectSlug, 'qa');
  const prHints = findPrOpenedHints(workItem.id);
  const workspaceDir = prHints.worktreePath;
  const prDiff = getPrDiff(workItem, workspaceDir, prHints.baseBranch);
  const regressionPolicy: RegressionPolicy = projectConfig?.regressionPolicy ?? 'escalate';
  const settingsProjectId = projectConfig?.id ?? projectSlug;
  const e2eConfigDefault: QaE2eMode =
    projectConfig?.qaE2eMode ?? (projectConfig?.stack?.e2eCommand != null ? 'ui-changed' : 'off');
  const qaE2eMode = getQaE2eMode(settingsProjectId, e2eConfigDefault);

  // Snapshot prior events BEFORE this run's outcome is appended.
  // shouldEscalateQa uses this count to decide: Nth failure = N-1 priors.
  const priorEvents = eventStore.replay({ workItemId: workItem.id });

  const evidencePosted = [...priorEvents].reverse().find((e) => e.kind === 'evidence.posted');
  const evidenceCommentUrl = (evidencePosted?.payload as { commentUrl?: string } | undefined)
    ?.commentUrl;

  const devTestsRun = findDevTestsRun(workItem.id, prHints.devRunId ?? prHints.pipelineRunId);

  try {
    // ─── Deterministic 3-tier verify (M19.19) ────────────────────────────────
    // Pulls the engineering spec persisted by spec-author (M19.17) and runs
    // the structural / functional / regression checks against the worktree.
    // Ground truth here precludes the QA agent from fabricating tier verdicts.
    // Lives inside the outer try/catch so getSpec/runDeterministicTiers
    // failures route through the standard QA escalation path
    // (agent.run-failed + factory:needs-human) instead of leaving the work
    // item stuck in factory:needs-qa.
    const specRecord = getSpec(projectSlug, workItem.id);
    let deterministic: DeterministicVerifyOutcome | null = null;
    if (specRecord != null && workspaceDir != null) {
      const implRunId = prHints.devRunId ?? prHints.pipelineRunId ?? runId;
      deterministic = await runDeterministicTiers({
        spec: specRecord.spec as EngineeringSpec,
        worktreePath: workspaceDir,
        implRunId,
        projectSlug,
        workItemId: workItem.id,
        runId,
        regressionPolicy,
        runTier,
        changedFiles: buildPrDiffWithContext(prDiff).changedFiles,
      });
    }

    // Tier 1/2 fail, or tier 3 fail with 'escalate' — synthesize qa.completed
    // and skip the agent entirely. Retry-counter routes to needs-fix loop or
    // escalates to needs-human exactly like a non-deterministic QA failure.
    if (deterministic?.shortCircuitTier != null) {
      const failedTier = deterministic.shortCircuitTier;
      const infrastructureFailure = classifyVerificationInfrastructureFailure(
        deterministic.tierResults[failedTier],
      );
      if (infrastructureFailure != null) {
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'qa.verification-blocked',
          payload: {
            failedTier,
            reason: infrastructureFailure.reason,
            findings: infrastructureFailure.findings,
            deterministic: true,
            agentSkipped: true,
            failureCategory: classifyQaFailure({ verificationInfrastructure: true }),
            ...(prHints.pipelineRunId != null ? { pipelineRunId: prHints.pipelineRunId } : {}),
          },
          runId,
        });
        await stateSource.comment(
          workItem.externalId,
          buildAgentComment(
            'QA',
            'Verification Blocked',
            'Deterministic verification failed because the verifier infrastructure is misconfigured. QA agent and fix-feedback were skipped.',
            [
              `Tier: ${failedTier}`,
              `Reason: ${infrastructureFailure.reason}`,
              'Next state: factory:needs-human',
              ...infrastructureFailure.findings.slice(0, 3).map((finding) => `Finding: ${finding}`),
            ],
          ),
        );
        accumulatePersonaStats({
          personaName: personaId,
          role: 'qa',
          outcome: 'failure',
          qualityScore: 0,
        });
        await stateSource.transitionState(
          workItem.externalId,
          'factory:needs-qa',
          'factory:needs-human',
        );
        emitStateTransitionEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          from: 'factory:needs-qa',
          to: 'factory:needs-human',
          by: 'qa',
          runId,
        });
        return;
      }

      const synthetic = buildSyntheticQaOutput({
        tierResults: deterministic.tierResults,
        failedTier,
        regressionPolicy,
      });

      eventStore.appendEvent({
        projectId: projectSlug,
        workItemId: workItem.id,
        kind: 'qa.completed',
        payload: {
          verdict: synthetic.verdict,
          overallScore: synthetic.overallScore,
          threshold: synthetic.threshold,
          tierResults: synthetic.tierResults,
          qualityScores: synthetic.qualityScores,
          findings: synthetic.findings,
          deterministic: true,
          agentSkipped: true,
          failureCategory: classifyQaFailure({ failedTier }),
          ...(prHints.pipelineRunId != null ? { pipelineRunId: prHints.pipelineRunId } : {}),
        },
        runId,
      });

      for (const summary of synthetic.decisionSummaries) {
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'agent.decision-summary',
          payload: { skill: 'qa', ...summary },
          runId,
        });
      }

      const needsEscalation = shouldEscalateQa(priorEvents);
      const nextState: StateName = needsEscalation ? 'factory:needs-human' : 'factory:qa-failed';
      if (needsEscalation) {
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'agent.retry-escalated',
          payload: { stage: 'qa', maxRetries: DEFAULT_MAX_RETRIES, runId },
          runId,
        });
      }

      await stateSource.comment(
        workItem.externalId,
        buildAgentComment(
          'QA',
          `Tier ${failedTier} Failed (deterministic)`,
          `Deterministic verification failed at tier ${failedTier} — QA agent skipped. Transitioning to ${nextState}.`,
          [
            `Tier ${failedTier} findings: ${
              deterministic.tierResults[failedTier]?.findings.length ?? 0
            }`,
            `Next state: ${nextState}`,
          ],
        ),
      );
      accumulatePersonaStats({
        personaName: personaId,
        role: 'qa',
        outcome: 'failure',
        qualityScore: 0,
      });
      await stateSource.transitionState(workItem.externalId, 'factory:needs-qa', nextState);
      emitStateTransitionEvent({
        projectId: projectSlug,
        workItemId: workItem.id,
        from: 'factory:needs-qa',
        to: nextState,
        by: 'qa',
        runId,
      });
      return;
    }

    // Tier 3 fail with 'ignore' is non-blocking: runTier already emitted
    // qa.regression-passed (since verifyRegression flips passed=true under
    // 'ignore') and the warning findings ride along on the qa.completed
    // payload via tierResults.regression. No extra event needed.

    // Run tests deterministically before invoking the QA agent so the agent
    // grades against real numbers instead of re-running the suite. Failures
    // here are non-fatal — the agent still runs without testRun.
    const testCommand = projectConfig?.stack?.testCommand ?? DEFAULT_TEST_COMMAND;
    const lintCommand = projectConfig?.stack?.lintCommand ?? 'pnpm biome check .';
    const typecheckCommand = projectConfig?.stack?.typecheckCommand;
    const configuredE2eCommand = projectConfig?.stack?.e2eCommand;
    const testCapture = resolveVitestJsonCapture({
      workspaceDir,
      runtime: projectConfig?.stack?.runtime,
      testCommand,
    });
    const [webPort, apiPort] =
      workspaceDir != null ? await Promise.all([findFreePort(), findFreePort()]) : [null, null];
    const qaEnv =
      workspaceDir != null && webPort != null && apiPort != null
        ? {
            WEB_PORT: String(webPort),
            CI: 'true',
            API_PORT: String(apiPort),
            MOCK_SERVER_PORT: String(apiPort),
            SERVER_PORT: String(apiPort),
          }
        : undefined;
    const {
      verificationSummary: rawVerificationSummary,
      testRun,
      e2eDecision,
    } = await buildVerificationSummary({
      workspaceDir,
      prHints,
      prDiff,
      qaE2eMode,
      configuredE2eCommand,
      commands: {
        testCommand,
        lintCommand,
        ...(typecheckCommand != null ? { typecheckCommand } : {}),
      },
      priorEvents,
      devTestsRun,
      testCapture,
      ...(qaEnv != null ? { commandEnv: qaEnv } : {}),
      commandTimeoutMs: resolvedBudget.budgets.timeoutMs,
      runTests,
      ...(runCommand != null ? { runCommand } : {}),
    });
    const verificationSummary = ensureExplicitEvidenceSummary({
      projectId: projectSlug,
      workItemId: workItem.id,
      runId,
      summary: rawVerificationSummary,
    });
    const criteriaResults = await runExecutableChecks({
      workspaceDir,
      checks: executableChecks,
      ...(qaEnv != null ? { env: qaEnv } : {}),
      defaultTimeoutMs: resolvedBudget.budgets.timeoutMs,
    });

    eventStore.appendEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      kind: 'qa.verification-summary-built',
      payload: {
        changedFileCount: verificationSummary.changedFiles.count,
        diffCharCount: verificationSummary.changedFiles.diffCharCount,
        contextByteSizeEstimate: estimateVerificationSummaryBytes(verificationSummary),
        lintStatus: verificationSummary.commands.lint?.status ?? 'skipped',
        typecheckStatus: verificationSummary.commands.typecheck?.status ?? 'skipped',
        testStatus: verificationSummary.commands.test.status,
        e2eStatus: verificationSummary.e2e.status,
        evidenceStatus: verificationSummary.evidence.status,
        evidenceReason: verificationSummary.evidence.reason,
        executableCheckCount: criteriaResults.length,
        executableCheckPassedCount: criteriaResults.filter((result) => result.passed).length,
      },
      runId,
    });

    const deterministicTierResults = deterministic
      ? toAgentTierResults(deterministic.tierResults)
      : undefined;
    const criteriaResultsForContext = compactCriteriaResultsForQaContext(criteriaResults);
    const preparedDiff = preparePrDiffContext({
      projectId: projectSlug,
      workItemId: workItem.id,
      runId,
      prDiff,
    });
    if (preparedDiff.disclosure != null) {
      eventStore.appendEvent({
        projectId: projectSlug,
        workItemId: workItem.id,
        kind: 'agent.disclosure',
        payload: {
          ...preparedDiff.disclosure,
          skill: 'qa',
          ...(prHints.pipelineRunId != null ? { pipelineRunId: prHints.pipelineRunId } : {}),
        },
        runId,
      });
    }
    const prDiffWithContext = buildPrDiffWithContext(prDiff);

    const qaContext = compactQaContextForPrompt({
      projectId: projectSlug,
      workItemId: workItem.id,
      workItem: {
        title: workItem.title,
        body: workItem.body,
        number: Number(workItem.externalId),
      },
      prDiff: preparedDiff.prDiffContext,
      prDiffWithContext,
      projectCommands: {
        testCommand,
        lintCommand,
        ...(e2eDecision.command != null ? { e2eCommand: e2eDecision.command } : {}),
      },
      verificationSummary,
      e2eDecision,
      ...(criteriaResultsForContext.length > 0
        ? { criteriaResults: criteriaResultsForContext }
        : {}),
      ...(acceptanceContract != null ? { acceptanceContract } : {}),
      ...(evidenceCommentUrl != null ? { evidenceCommentUrl } : {}),
      ...(devTestsRun != null ? { devTestsRun } : {}),
      ...(deterministicTierResults != null ? { deterministicTierResults } : {}),
    });

    const qaResult = await runtime.run({
      runId,
      role: 'qa',
      skill: 'qa',
      context: qaContext,
      contextAllowlist: [
        'workItem',
        'prDiff',
        'prDiffWithContext',
        'projectCommands',
        'verificationSummary',
        'e2eDecision',
        'criteriaResults',
        ...(acceptanceContract != null ? ['acceptanceContract'] : []),
        ...(evidenceCommentUrl != null ? ['evidenceCommentUrl'] : []),
        ...(devTestsRun != null ? ['devTestsRun'] : []),
        ...(deterministicTierResults != null ? ['deterministicTierResults'] : []),
      ],
      freshContext: true,
      toolBundles: ['read', 'qa-tools'],
      workspaceDir,
      toolExtras: [],
      ...(qaEnv != null ? { env: qaEnv } : {}),
      ...resolvedBudget,
      personaId,
      outputJsonSchema: qaJsonSchema,
      appendSystemPrompt: qaPrompt,
    });

    const criteriaResultReconciliation = restoreWorkflowOwnedCriteriaResults({
      output: qaResult.output,
      criteriaResults,
      contextCriteriaResults: criteriaResultsForContext,
    });
    if (criteriaResultReconciliation.warning != null) {
      eventStore.appendEvent({
        projectId: projectSlug,
        workItemId: workItem.id,
        kind: 'agent.log',
        payload: {
          runId,
          skill: 'qa',
          stream: 'telemetry',
          metric: 'criteria_results_agent_copy_replaced',
          reason: criteriaResultReconciliation.warning.reason,
          ...(criteriaResultReconciliation.warning.issues != null
            ? { issues: criteriaResultReconciliation.warning.issues }
            : {}),
        },
        runId,
        personaId,
      });
    }

    const qaParsed = safeParseOutputForSchema(QaOutputSchema, criteriaResultReconciliation.output);
    if (!qaParsed.success) {
      throw new Error(`QA output validation failed: ${JSON.stringify(qaParsed.error.issues)}`);
    }
    const qaOutput = qaParsed.data;

    // Disagreement guard — agent cannot override deterministic ground truth.
    if (deterministic != null) {
      const disagreements = detectTierDisagreement(qaOutput.tierResults, deterministic.tierResults);
      if (disagreements.length > 0) {
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'qa.tier-disagreement',
          payload: { runId, disagreements },
          runId,
        });
        throw new Error(
          `QA agent disagreed with deterministic tier verdict: ${JSON.stringify(disagreements)}`,
        );
      }
    }

    // Emit tier-specific failure events for downstream subscribers. Use
    // deterministic ground truth where available; fall back to the agent's
    // self-reported tier results when no spec was on file.
    const groundTruthTierResults: QaOutput['tierResults'] =
      deterministicTierResults ?? qaOutput.tierResults;
    const TIER_EVENTS = {
      structural: 'qa.structural-failed',
      functional: 'qa.functional-failed',
      regression: 'qa.regression-failed',
    } as const;
    for (const [tier, kind] of Object.entries(TIER_EVENTS) as [
      keyof typeof TIER_EVENTS,
      (typeof TIER_EVENTS)[keyof typeof TIER_EVENTS],
    ][]) {
      if (!groundTruthTierResults[tier].passed) {
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind,
          payload: {
            tier,
            findings: groundTruthTierResults[tier].findings,
            failureCategory: classifyQaFailure({ failedTier: tier }),
          },
          runId,
        });
      }
    }

    // Emit qa.completed with full payload (qualityScores included for UI and history).
    // testRun is the workflow-captured one (deterministic), not whatever the
    // agent might echo back — even if the schema accepts it from the agent,
    // we trust our own measurement.
    const executableChecksPassed =
      criteriaResults.length === 0 || criteriaResults.every((result) => result.passed);
    const verdict = executableChecksPassed ? qaOutput.verdict : 'fail';
    const verifiedFollowUpRefs = await verifiedFollowUpRefsForQaOutput(qaOutput, stateSource);
    const qaActionability = classifyQaFailureActionability(
      {
        findings: qaOutput.findings,
        criteriaResults,
        tierResults: groundTruthTierResults,
        verificationSummary,
      },
      { verifiedFollowUpRefs },
    );
    const actionableQaItems = collectActionableQaItems(
      {
        findings: qaOutput.findings,
        criteriaResults,
        tierResults: groundTruthTierResults,
        verificationSummary,
      },
      { verifiedFollowUpRefs, verificationSummary },
    );
    const failedTier = (['structural', 'functional', 'regression'] as const).find(
      (tier) => !groundTruthTierResults[tier].passed,
    );
    const hasFailedExecutableCheck = criteriaResults.some((result) => !result.passed);
    const qaFailureCategory =
      verdict === 'pass' && actionableQaItems.length === 0 && !hasFailedExecutableCheck
        ? undefined
        : qaActionability.classification === 'infrastructure-timeout'
          ? classifyQaFailure({ verificationInfrastructure: true })
          : qaActionability.classification === 'regression-unrelated'
            ? classifyQaFailure({ failedTier: 'regression' })
            : classifyQaFailure({
                failedTier,
                hasActionableFinding: actionableQaItems.length > 0,
                hasFailedExecutableCheck,
              });

    eventStore.appendEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      kind: 'qa.completed',
      payload: {
        verdict,
        overallScore: qaOutput.overallScore,
        threshold: qaOutput.threshold,
        tierResults: groundTruthTierResults,
        qualityScores: qaOutput.qualityScores,
        findings: qaOutput.findings,
        verificationSummary,
        qaActionability,
        ...(qaFailureCategory != null ? { failureCategory: qaFailureCategory } : {}),
        ...(criteriaResults.length > 0 ? { criteriaResults } : {}),
        ...(testRun ? { testRun } : {}),
        ...(deterministic != null ? { deterministic: true } : {}),
        ...(prHints.pipelineRunId != null ? { pipelineRunId: prHints.pipelineRunId } : {}),
      },
      runId,
    });

    for (const cr of criteriaResults) {
      eventStore.appendEvent({
        projectId: projectSlug,
        workItemId: workItem.id,
        kind: 'agent.verify-command',
        payload: {
          runId,
          criterionId: cr.criterionId,
          checkId: cr.checkId,
          ac: cr.ac,
          command: cr.command,
          exitCode: cr.exitCode,
          actual: cr.actual,
          passed: cr.passed,
        },
        runId,
      });
    }

    reconcileDecisionSummaries(runId, projectSlug, workItem.id, 'qa', qaOutput.decisionSummaries);

    // Determine next state. Use priorEvents (snapshotted before this run) so the
    // retry count reflects completed prior failures, not the current one.
    const passes =
      actionableQaItems.length === 0 &&
      (verdict === 'pass' ||
        (verdict === 'fail' &&
          failVerdictHasOnlyNonBlockingFindings(qaOutput, verifiedFollowUpRefs)) ||
        (verdict === 'partial' && qaOutput.overallScore >= qaOutput.threshold));

    let nextState: StateName;
    if (passes) {
      nextState = 'factory:needs-review';
    } else if (!qaActionability.actionable) {
      nextState = 'factory:needs-human';
    } else {
      const needsEscalation = shouldEscalateQa(priorEvents);
      nextState = needsEscalation ? 'factory:needs-human' : 'factory:qa-failed';
      if (needsEscalation) {
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'agent.retry-escalated',
          payload: { stage: 'qa', maxRetries: DEFAULT_MAX_RETRIES, runId },
          runId,
        });
      }
    }

    const scoreLabel = `${qaOutput.overallScore}/${qaOutput.threshold}`;
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment(
        'QA',
        passes ? 'Pass' : 'Fail',
        `Score ${scoreLabel} — transitioning to ${nextState}`,
        [`Score: ${scoreLabel}`, `Next state: ${nextState}`],
      ),
    );
    accumulatePersonaStats({
      personaName: personaId,
      role: 'qa',
      outcome: passes ? 'success' : 'failure',
      qualityScore: qaOutput.overallScore / 100,
    });
    await stateSource.transitionState(workItem.externalId, 'factory:needs-qa', nextState);
    emitStateTransitionEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      from: 'factory:needs-qa',
      to: nextState,
      by: 'qa',
      runId,
    });
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'qa', outcome: 'failure' });
    const error = err instanceof Error ? err : new Error(String(err));
    eventStore.appendEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: {
        runId,
        error: error.message,
        failureCategory: classifyQaFailure({ orchestration: true }),
      },
      runId,
    });
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment('QA', 'Failed', 'QA run failed — escalating to needs-human', [
        `Error: ${error.message}`,
      ]),
    );
    await stateSource.transitionState(
      workItem.externalId,
      'factory:needs-qa',
      'factory:needs-human',
    );
    emitStateTransitionEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      from: 'factory:needs-qa',
      to: 'factory:needs-human',
      by: 'qa',
      runId,
    });
  }
}

function resolveVitestJsonCapture(input: {
  workspaceDir?: string;
  runtime?: string;
  testCommand: string;
}): { enabled: boolean; reason?: string } {
  if (input.workspaceDir == null) return { enabled: true };
  if (input.runtime != null && input.runtime !== 'node') {
    return {
      enabled: false,
      reason: `structured test capture requires a Vitest-compatible Node command; ${input.runtime} test command should be run by QA directly`,
    };
  }
  if (
    input.runtime === 'node' &&
    !isVitestCompatibleCommand(input.workspaceDir, input.testCommand)
  ) {
    return {
      enabled: false,
      reason: 'structured test capture requires a Vitest-compatible test command',
    };
  }
  return { enabled: true };
}

function isVitestCompatibleCommand(workspaceDir: string, command: string): boolean {
  if (/\bvitest\b/.test(command) || /--reporter(?:=|\s+)json\b/.test(command)) return true;
  const scriptName = packageScriptNameFromCommand(command);
  if (scriptName == null) return false;

  const packageJsonPath = join(workspaceDir, 'package.json');
  if (!existsSync(packageJsonPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, unknown>;
    };
    const script = parsed.scripts?.[scriptName];
    return typeof script === 'string' && /\bvitest\b/.test(script);
  } catch {
    return false;
  }
}

function packageScriptNameFromCommand(command: string): string | null {
  const parts = command.trim().split(/\s+/);
  const [tool, maybeRun, maybeScript] = parts;
  if (tool === 'pnpm' || tool === 'npm' || tool === 'yarn') {
    return maybeRun === 'run' ? (maybeScript ?? null) : (maybeRun ?? null);
  }
  if (tool === 'bun' && maybeRun === 'run') return maybeScript ?? null;
  return null;
}
