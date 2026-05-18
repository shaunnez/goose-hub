import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { findFreePort } from '@goose-hub/core/agent-runtime/find-free-port.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
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
import { DEFAULT_MAX_RETRIES, shouldEscalateQa } from '@goose-hub/core/retry/retry-counter.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { RegressionPolicy } from '@goose-hub/core/verify/tiers.js';
import { runTier as defaultRunTier } from '@goose-hub/core/verify/tiers.js';
import { type QaOutput, QaOutputSchema, type TestRun } from '@goose-hub/skills/qa/schema.js';
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
  /** Per-AC verify commands extracted from the issue body before QA spawn. */
  verifyCommands?: VerifyCommand[];
  /** Inject for tests — return the spec for this work item, or null. */
  getEngineeringSpecImpl?: typeof defaultGetEngineeringSpec;
  /** Inject for tests — run a single deterministic verify tier. */
  runTierImpl?: typeof defaultRunTier;
}

const DEFAULT_TEST_COMMAND = 'pnpm test --reporter=json';

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
  const verifyCommands = deps.verifyCommands;
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

  const devTestsRun = findDevTestsRun(workItem.id);

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
      });
    }

    // Tier 1/2 fail, or tier 3 fail with 'escalate' — synthesize qa.completed
    // and skip the agent entirely. Retry-counter routes to needs-fix loop or
    // escalates to needs-human exactly like a non-deterministic QA failure.
    if (deterministic?.shortCircuitTier != null) {
      const failedTier = deterministic.shortCircuitTier;
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
    const { verificationSummary, testRun, e2eDecision } = await buildVerificationSummary({
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
      runTests,
      ...(runCommand != null ? { runCommand } : {}),
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
      },
      runId,
    });

    const [webPort, apiPort] =
      workspaceDir != null ? await Promise.all([findFreePort(), findFreePort()]) : [null, null];

    const deterministicTierResults = deterministic
      ? toAgentTierResults(deterministic.tierResults)
      : undefined;

    const qaResult = await runtime.run({
      runId,
      role: 'qa',
      skill: 'qa',
      context: {
        projectId: projectSlug,
        workItemId: workItem.id,
        workItem: {
          title: workItem.title,
          body: workItem.body,
          number: Number(workItem.externalId),
        },
        prDiff,
        projectCommands: {
          testCommand,
          lintCommand,
          ...(e2eDecision.command != null ? { e2eCommand: e2eDecision.command } : {}),
        },
        verificationSummary,
        e2eDecision,
        ...(verifyCommands != null && verifyCommands.length > 0 ? { verifyCommands } : {}),
        testRun,
        ...(evidenceCommentUrl != null ? { evidenceCommentUrl } : {}),
        ...(devTestsRun != null ? { devTestsRun } : {}),
        ...(deterministicTierResults != null ? { deterministicTierResults } : {}),
      },
      contextAllowlist: [
        'workItem',
        'prDiff',
        'projectCommands',
        'verificationSummary',
        'e2eDecision',
        'testRun',
        'verifyCommands',
        ...(evidenceCommentUrl != null ? ['evidenceCommentUrl'] : []),
        ...(devTestsRun != null ? ['devTestsRun'] : []),
        ...(deterministicTierResults != null ? ['deterministicTierResults'] : []),
      ],
      freshContext: true,
      toolBundles: ['read', 'qa-tools'],
      workspaceDir,
      toolExtras: [],
      ...(workspaceDir != null && webPort != null && apiPort != null
        ? {
            env: {
              WEB_PORT: String(webPort),
              CI: 'true',
              API_PORT: String(apiPort),
              MOCK_SERVER_PORT: String(apiPort),
              SERVER_PORT: String(apiPort),
            },
          }
        : {}),
      ...resolvedBudget,
      personaId,
      outputJsonSchema: qaJsonSchema,
      appendSystemPrompt: qaPrompt,
    });

    const qaParsed = QaOutputSchema.safeParse(qaResult.output);
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
          payload: { tier, findings: groundTruthTierResults[tier].findings },
          runId,
        });
      }
    }

    // Emit qa.completed with full payload (qualityScores included for UI and history).
    // testRun is the workflow-captured one (deterministic), not whatever the
    // agent might echo back — even if the schema accepts it from the agent,
    // we trust our own measurement.
    eventStore.appendEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      kind: 'qa.completed',
      payload: {
        verdict: qaOutput.verdict,
        overallScore: qaOutput.overallScore,
        threshold: qaOutput.threshold,
        tierResults: groundTruthTierResults,
        qualityScores: qaOutput.qualityScores,
        findings: qaOutput.findings,
        ...(testRun ? { testRun } : {}),
        ...(deterministic != null ? { deterministic: true } : {}),
        ...(prHints.pipelineRunId != null ? { pipelineRunId: prHints.pipelineRunId } : {}),
      },
      runId,
    });

    for (const cr of qaOutput.criteriaResults ?? []) {
      eventStore.appendEvent({
        projectId: projectSlug,
        workItemId: workItem.id,
        kind: 'agent.verify-command',
        payload: { runId, ac: cr.ac, command: cr.command, actual: cr.actual, passed: cr.passed },
        runId,
      });
    }

    reconcileDecisionSummaries(runId, projectSlug, workItem.id, 'qa', qaOutput.decisionSummaries);

    // Determine next state. Use priorEvents (snapshotted before this run) so the
    // retry count reflects completed prior failures, not the current one.
    const passes =
      qaOutput.verdict === 'pass' ||
      (qaOutput.verdict === 'partial' && qaOutput.overallScore >= qaOutput.threshold);

    let nextState: StateName;
    if (passes) {
      nextState = 'factory:needs-review';
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
      payload: { runId, error: error.message },
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
