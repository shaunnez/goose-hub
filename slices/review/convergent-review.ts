import { resolveAcceptanceContract } from '@goose-hub/core/acceptance-contracts/resolver.js';
// slices/review/convergent-review.ts
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { assembleSpawnContext } from '@goose-hub/core/agent-runtime/context-assembly.js';
import type { AgentResult, AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { safeParseOutputForSchema } from '@goose-hub/core/agent-runtime/output-normalization.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { reconcileDecisionSummaries } from '@goose-hub/core/agent-runtime/reconcile-decisions.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { selectRuntime } from '@goose-hub/core/agent-runtime/select-runtime.js';
import { resolveSkillRuntimeForProject } from '@goose-hub/core/agent-runtime/skill-runtime-resolver.js';
import {
  parseReviewerSlots,
  readProjectReviewSettings,
} from '@goose-hub/core/db/repositories/project-review-settings.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import { DEFAULT_MAX_RETRIES, shouldEscalateReview } from '@goose-hub/core/retry/retry-counter.js';
import { classifyTopic } from '@goose-hub/core/review/topic-classifier.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { emitCapApplied, loadLatestRoute } from '@goose-hub/core/workflow-routing/events.js';
import { effectiveReviewerSlots } from '@goose-hub/core/workflow-routing/reviewer-cap.js';
import { ReviewOutputSchema } from '@goose-hub/skills/review/schema.js';
import type { ReviewOutput, ReviewVerdict } from '@goose-hub/skills/review/schema.js';

import { finalizeConvergentReviewAudit, startConvergentReviewAudit } from './review-audit.js';
import {
  DEFAULT_MAX_REVIEW_ROUNDS,
  DEFAULT_REVIEWER_SLOTS,
  type DispatchReviewWaveOpts,
  type FindingKey,
  type ReviewWaveResult,
  buildReviewSpec,
  deduplicateFindings,
  extractChangedFilePaths,
  findingKeyStr,
  hasCanonicalCriteriaCoverage,
  withCanonicalCriterionIds,
} from './review-spec.js';

export type { DispatchReviewWaveOpts, FindingKey, ReviewWaveResult };

function findPipelineRunId(projectSlug: string, workItemId: string): string | undefined {
  const events = eventStore.replay({ projectId: projectSlug, workItemId });
  const prOpened = events
    .slice()
    .reverse()
    .find((e) => e.kind === 'pr.opened');
  const payload = prOpened?.payload as { pipelineRunId?: string } | undefined;
  return typeof payload?.pipelineRunId === 'string' ? payload.pipelineRunId : undefined;
}

function getQaVerdict(
  events: { kind: string; payload: string | unknown }[],
): { verdict: string; overallScore: number } | undefined {
  const qaEvents = events.filter((e) => e.kind === 'qa.completed');
  if (qaEvents.length === 0) return undefined;
  const last = qaEvents[qaEvents.length - 1];
  const p = (typeof last.payload === 'string' ? JSON.parse(last.payload) : last.payload) as {
    verdict?: string;
    overallScore?: number;
  };
  if (p.verdict == null || p.overallScore == null) return undefined;
  return { verdict: p.verdict, overallScore: p.overallScore };
}

/**
 * Spawns configured reviewer slots concurrently for one review round (M19.20).
 * Slots are read from project_review_settings DB; defaults to constrained +
 * unconstrained on claude if not configured. Each spawn routes through
 * assembleSpawnContext for holdout boundary enforcement (rule 1, ADR 0014).
 * No advisor (rule 20). Any slot parse failure → returns parseFailure: true.
 * Divergent verdicts (approved + needs-fix) still preserve verdictsDiverge
 * metadata, but actionable needs-fix verdicts route to the repair workflow.
 */
export async function dispatchReviewWave(opts: DispatchReviewWaveOpts): Promise<ReviewWaveResult> {
  const {
    pr,
    qaResult,
    acceptanceContract,
    round,
    priorFindings,
    workItem,
    projectSlug,
    reviewWorkflowRunId,
    runtimeForSlot,
  } = opts;

  const projectConfig = await getProjectBySlug(projectSlug);
  const reviewJsonSchema = toJsonSchema(ReviewOutputSchema);
  const resolvedRuntime = resolveSkillRuntimeForProject({
    skill: 'review',
    projectBudgets: projectConfig?.budgets,
    projectId: projectSlug,
    configRuntime: projectConfig?.agentConfig?.runtime ?? 'auto',
    role: 'reviewer',
    allowHoldoutOverride: projectConfig?.agentConfig?.allowHoldoutOverride,
  });

  // Read configurable slots from DB; fall back to defaults.
  // verdictsDiverge escalation only applies when slots are explicitly configured (not defaults).
  const settingsRow = readProjectReviewSettings(projectConfig?.id ?? projectSlug);
  const configuredSlots = parseReviewerSlots(settingsRow);

  // Intersect route cap with configured/default slots. Route cap is an upper bound only.
  const route = loadLatestRoute({ projectId: projectSlug, workItemId: workItem.id });
  const routeReviewerCap = route?.budgetCaps?.reviewerSlots ?? null;
  const baseSlots = configuredSlots ?? DEFAULT_REVIEWER_SLOTS;
  const effectiveSlotCount = effectiveReviewerSlots(
    routeReviewerCap ?? baseSlots.length,
    configuredSlots?.length ?? null,
  );

  if (routeReviewerCap != null && effectiveSlotCount < baseSlots.length) {
    emitCapApplied({
      projectId: projectSlug,
      workItemId: workItem.id,
      conflict: {
        requiredTier: route?.tier ?? 'T1',
        effectiveTier: route?.tier ?? 'T1',
        cappedBy: 'reviewerSlots',
        reason: `reviewer slots capped at ${effectiveSlotCount} by route tier ${route?.tier ?? 'T1'}`,
        hasSensitivePath: route?.evidence.signals?.hasSensitivePath === true,
      },
    });
  }

  const slots = baseSlots.slice(0, effectiveSlotCount);
  const slotsAreConfigured = configuredSlots != null;

  const runIds = slots.map(() => crypto.randomUUID());
  const personaIds = slots.map(() => selectPersona(projectSlug, 'reviewer').personaId);

  const specs = slots.map((slot, i) => {
    const variant = slot.prompt === 'default' ? undefined : slot.prompt;
    const reviewPrompt = readPromptWithContext('review', projectSlug, variant);
    return buildReviewSpec({
      runId: runIds[i],
      projectSlug,
      workItem,
      prDiff: pr.prDiff,
      qaResult,
      acceptanceContract,
      personaId: personaIds[i],
      reviewPrompt,
      reviewJsonSchema,
      resolvedBudgets: resolvedRuntime,
      extraEventPayload: {
        reviewWorkflowRunId,
        round,
        slotIndex: i,
        slotModel: resolvedRuntime.provider,
        promptVariant: slot.prompt,
      },
    });
  });

  // Route each spawn through assembleSpawnContext to enforce holdout boundary.
  specs.forEach(assembleSpawnContext);

  const rawResults = await Promise.all(
    specs.map((spec) =>
      runtimeForSlot(resolvedRuntime.provider)
        .run(spec)
        .catch((err: unknown) => (err instanceof Error ? err : new Error(String(err)))),
    ),
  );

  const parsed = rawResults.map((r) =>
    r instanceof Error ? null : safeParseOutputForSchema(ReviewOutputSchema, r.output),
  );

  const normalizedReviewerOutputs = parsed.map((p) =>
    p?.success ? withCanonicalCriterionIds(p.data, acceptanceContract) : null,
  );

  const successfulReviewerOutputs = normalizedReviewerOutputs.flatMap((output, i) => {
    if (output == null || !hasCanonicalCriteriaCoverage(output, acceptanceContract)) return [];
    const slot = slots[i];
    return [
      {
        parsed: output,
        runId: runIds[i],
        round,
        slotIndex: i,
        slotModel: resolvedRuntime.provider,
        promptVariant: slot.prompt,
      },
    ];
  });

  for (const output of successfulReviewerOutputs) {
    eventStore.appendEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      kind: 'review.slot-completed',
      payload: {
        reviewWorkflowRunId,
        round: output.round,
        slotIndex: output.slotIndex,
        slotModel: output.slotModel,
        promptVariant: output.promptVariant,
        verdict: output.parsed.verdict,
        confidence: output.parsed.confidence,
        findingsCount: output.parsed.findings.length,
        criteriaChecks: output.parsed.criteriaChecks,
      },
      runId: output.runId,
    });
    reconcileDecisionSummaries(
      output.runId,
      projectSlug,
      workItem.id,
      'review',
      output.parsed.decisionSummaries,
    );
  }

  const coverageFailures = parsed.flatMap((p, i) => {
    if (p == null || !p.success) return [];
    const output = normalizedReviewerOutputs[i];
    return output != null && hasCanonicalCriteriaCoverage(output, acceptanceContract)
      ? []
      : [`slot ${i} missing canonical acceptance criteria coverage`];
  });

  if (parsed.some((p) => p == null || !p.success) || coverageFailures.length > 0) {
    const errors = rawResults
      .map((r, i) => {
        if (r instanceof Error) return r.message;
        const p = parsed[i];
        if (p != null && !p.success) return JSON.stringify(p.error.issues);
        return null;
      })
      .filter(Boolean);
    return {
      roundFindings: [],
      newCriticalFindings: [],
      reviewerOutputs: [],
      parseFailure: true,
      parseFailureError: [...errors, ...coverageFailures].join('; '),
      anyNeedsHuman: false,
      anyNeedsFix: false,
      verdictsDiverge: false,
    };
  }

  const parsedData = successfulReviewerOutputs.map((output) => output.parsed);
  const allFindings = parsedData.flatMap((d) => d.findings);
  const roundFindings = deduplicateFindings(allFindings);

  const priorKeyStrs = new Set(priorFindings.map(findingKeyStr));
  const newCriticalFindings = roundFindings.filter(
    (k) => k.isCritical && !priorKeyStrs.has(findingKeyStr(k)),
  );

  const verdicts = parsedData.map((d) => d.verdict);
  const anyNeedsHuman = verdicts.some((v) => v === 'needs-human');
  const anyNeedsFix = verdicts.some((v) => v === 'needs-fix');
  // Divergent-verdict escalation only applies to explicitly configured slot sets (M19.20).
  const verdictsDiverge =
    slotsAreConfigured &&
    verdicts.some((v) => v === 'approved') &&
    verdicts.some((v) => v === 'needs-fix');

  return {
    roundFindings,
    newCriticalFindings,
    reviewerOutputs: successfulReviewerOutputs,
    parseFailure: false,
    anyNeedsHuman,
    anyNeedsFix,
    verdictsDiverge,
  };
}

/**
 * Convergent adversarial review workflow (M19.04).
 * Runs up to maxReviewRounds rounds of 2-reviewer parallel dispatch.
 * Converges when 2 consecutive rounds have 0 new CRITICAL findings and
 * round >= minRounds. Escalates on parse failure or unresolved CRITICAL at cap.
 */
export async function runConvergentReviewWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  projectSlug: string,
  _targetRepo: string,
  deps: { runtime?: AgentRuntime } = {},
): Promise<void> {
  const reviewWorkflowRunId = crypto.randomUUID();
  const reviewWorkflowPayload = { reviewWorkflowRunId };
  const injectedRuntime = deps.runtime;
  const projectConfig = await getProjectBySlug(projectSlug);
  const runtimeForSlot = injectedRuntime
    ? () => injectedRuntime
    : (provider: 'claude' | 'codex') => {
        const configRuntime = projectConfig?.agentConfig?.runtime ?? 'auto';
        return selectRuntime({ configRuntime, skillProvider: provider });
      };
  const maxReviewRounds = projectConfig?.maxReviewRounds ?? DEFAULT_MAX_REVIEW_ROUNDS;

  try {
    const prDiff = await stateSource.getPrDiff(workItem.externalId);
    const changedFilePaths = extractChangedFilePaths(prDiff);
    const { minRounds } = classifyTopic(changedFilePaths);
    const priorEvents = eventStore.replay({ workItemId: workItem.id });
    const qaResult = getQaVerdict(priorEvents);
    const acceptanceContract = resolveAcceptanceContract({
      projectId: projectSlug,
      workItemId: workItem.id,
      issueBody: workItem.body,
    });
    const pr = { externalId: workItem.externalId, prDiff };
    const pipelineRunId = findPipelineRunId(projectSlug, workItem.id);
    const pipelineRunIdPayload = pipelineRunId != null ? { pipelineRunId } : {};

    // ─── code-quality-audit parallel branch (#698) ──────────────────────────
    // priority:high (or critical) PRs trigger an audit alongside the
    // reviewers. The audit is a *separate slot* — its findings never block a
    // reviewer's verdict, but its top-3 recommendations become
    // ImprovementCandidates and the autonomy gate (score < 60 in autonomous
    // mode) blocks transition to factory:approved.
    const auditPromise = startConvergentReviewAudit({
      workItem,
      projectSlug,
      pipelineRunId,
      mode: projectConfig?.mode ?? 'supervised',
    });

    let previousRoundFindings: FindingKey[] = [];
    let consecutiveZeroCriticalRounds = 0;

    for (let round = 1; round <= maxReviewRounds; round++) {
      const waveResult = await dispatchReviewWave({
        pr,
        qaResult,
        acceptanceContract,
        round,
        priorFindings: previousRoundFindings,
        workItem,
        projectSlug,
        reviewWorkflowRunId,
        runtimeForSlot,
      });

      if (waveResult.parseFailure) {
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'review.wave-failed',
          payload: { ...reviewWorkflowPayload, round, error: waveResult.parseFailureError },
          runId: crypto.randomUUID(),
        });
        await stateSource.comment(
          workItem.externalId,
          buildAgentComment(
            'Review',
            'Failed',
            `Round ${round} reviewer parse failure — escalating to needs-human`,
            [`Error: ${waveResult.parseFailureError}`],
          ),
        );
        await stateSource.transitionState(
          workItem.externalId,
          'factory:needs-review',
          'factory:needs-human',
        );
        emitStateTransitionEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          from: 'factory:needs-review',
          to: 'factory:needs-human',
          by: 'convergent-review',
          extraPayload: reviewWorkflowPayload,
        });
        return;
      }

      eventStore.appendEvent({
        projectId: projectSlug,
        workItemId: workItem.id,
        kind: 'review.wave-completed',
        payload: {
          ...reviewWorkflowPayload,
          round,
          roundFindingsCount: waveResult.roundFindings.length,
          newCriticalCount: waveResult.newCriticalFindings.length,
          anyNeedsHuman: waveResult.anyNeedsHuman,
          anyNeedsFix: waveResult.anyNeedsFix,
        },
        runId: crypto.randomUUID(),
      });

      // P1 fix: a reviewer returning needs-human must escalate immediately (rule 23, holdout)
      // only when the wave does not also provide actionable repair findings.
      if (waveResult.anyNeedsHuman && !waveResult.anyNeedsFix) {
        const humanReviewer = waveResult.reviewerOutputs.find(
          (r) => r.parsed.verdict === 'needs-human',
        );
        const escalationReason =
          humanReviewer?.parsed.verdict === 'needs-human'
            ? humanReviewer.parsed.escalationReason
            : 'Reviewer requested human review';
        const runId = crypto.randomUUID();
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'review.escalated',
          payload: {
            ...reviewWorkflowPayload,
            reason: 'reviewer-needs-human',
            round,
            escalationReason,
          },
          runId,
        });
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'review.completed',
          payload: {
            ...reviewWorkflowPayload,
            verdict: 'needs-human',
            confidence: humanReviewer?.parsed.confidence ?? 0,
            criteriaChecks: humanReviewer?.parsed.criteriaChecks ?? [],
            findings: humanReviewer?.parsed.findings ?? [],
            escalationReason,
            ...pipelineRunIdPayload,
          },
          runId,
        });
        await stateSource.comment(
          workItem.externalId,
          buildAgentComment(
            'Review',
            'Needs Human',
            `Round ${round} reviewer requested human review: ${escalationReason}`,
            [],
          ),
        );
        await stateSource.transitionState(
          workItem.externalId,
          'factory:needs-review',
          'factory:needs-human',
        );
        emitStateTransitionEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          from: 'factory:needs-review',
          to: 'factory:needs-human',
          by: 'convergent-review',
          runId,
          extraPayload: reviewWorkflowPayload,
        });
        return;
      }

      const allReviewersNeedFix =
        waveResult.reviewerOutputs.length > 0 &&
        waveResult.reviewerOutputs.every((reviewer) => reviewer.parsed.verdict === 'needs-fix');
      const actionableNonCriticalNeedsFix =
        waveResult.anyNeedsFix && waveResult.newCriticalFindings.length === 0;

      // Configured reviewer slots can deliberately mix constrained and
      // adversarial prompts. If any reviewer provides a needs-fix verdict, the
      // finding is actionable repair input rather than a human-arbitration
      // problem, even when another reviewer requested human confirmation. New
      // critical findings still use the multi-round convergence/cap path.
      if (actionableNonCriticalNeedsFix || waveResult.verdictsDiverge || allReviewersNeedFix) {
        const runId = crypto.randomUUID();
        const allFindings = waveResult.reviewerOutputs.flatMap((r) => r.parsed.findings);
        const criteriaChecks = waveResult.reviewerOutputs.flatMap((r) => r.parsed.criteriaChecks);
        const needsEscalation = shouldEscalateReview(priorEvents);
        const nextState = needsEscalation ? 'factory:needs-human' : 'factory:needs-fix';
        const reason = waveResult.verdictsDiverge
          ? 'divergent-verdicts-actionable-needs-fix'
          : 'reviewer-needs-fix';
        const confidence =
          waveResult.reviewerOutputs.length > 0
            ? Math.min(...waveResult.reviewerOutputs.map((r) => r.parsed.confidence))
            : 0;

        if (needsEscalation) {
          eventStore.appendEvent({
            projectId: projectSlug,
            workItemId: workItem.id,
            kind: 'review.escalated',
            payload: { ...reviewWorkflowPayload, reason, round, targetState: nextState },
            runId,
          });
        }
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'review.completed',
          payload: {
            ...reviewWorkflowPayload,
            verdict: needsEscalation ? 'needs-human' : 'needs-fix',
            confidence,
            criteriaChecks,
            findings: allFindings,
            ...(needsEscalation
              ? {
                  escalationReason: `Review requested fixes after ${DEFAULT_MAX_RETRIES} prior repair cycle(s); human arbitration required`,
                }
              : {}),
            ...pipelineRunIdPayload,
          },
          runId,
        });
        await stateSource.comment(
          workItem.externalId,
          buildAgentComment(
            'Review',
            needsEscalation ? 'Needs Human' : 'Needs Fix',
            needsEscalation
              ? `Round ${round} requested fixes after the retry cap — human arbitration required`
              : `Round ${round} reviewer feedback requested fixes — sending back to repair`,
            allFindings
              .slice(0, 5)
              .map((finding) => `[${finding.severity}] ${finding.description}`),
          ),
        );
        await stateSource.transitionState(workItem.externalId, 'factory:needs-review', nextState);
        emitStateTransitionEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          from: 'factory:needs-review',
          to: nextState,
          by: 'convergent-review',
          runId,
          extraPayload: reviewWorkflowPayload,
        });
        return;
      }

      if (waveResult.newCriticalFindings.length === 0 && !waveResult.anyNeedsFix) {
        consecutiveZeroCriticalRounds++;
      } else {
        consecutiveZeroCriticalRounds = 0;
      }

      // Update prior findings to this round's findings for next-round comparison.
      previousRoundFindings = waveResult.roundFindings;

      const isConverged = consecutiveZeroCriticalRounds >= 2 && round >= minRounds;

      if (isConverged) {
        const lastOutputs = waveResult.reviewerOutputs;
        const avgConfidence =
          lastOutputs.length > 0
            ? lastOutputs.reduce((s, r) => s + r.parsed.confidence, 0) / lastOutputs.length
            : 1;
        const runId = crypto.randomUUID();
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'review.converged',
          payload: { ...reviewWorkflowPayload, totalRounds: round },
          runId,
        });

        // Settle the parallel audit (#698) BEFORE emitting review.completed
        // so downstream consumers (merge-decision, quality assembly) never
        // see a transient 'approved' verdict for a cycle the audit blocked.
        const auditOutcome = await finalizeConvergentReviewAudit(auditPromise, {
          projectSlug,
          workItem,
        });

        const finalVerdict: ReviewVerdict = auditOutcome.autonomyGateFired
          ? 'needs-human'
          : 'approved';

        const escalationReason = auditOutcome.autonomyGateFired
          ? `Architectural quality audit blocked auto-merge (score ${auditOutcome.auditScore} < 60)`
          : undefined;

        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'review.completed',
          payload: {
            ...reviewWorkflowPayload,
            verdict: finalVerdict,
            confidence: avgConfidence,
            criteriaChecks: lastOutputs.flatMap((r) => r.parsed.criteriaChecks),
            findings: lastOutputs.flatMap((r) => r.parsed.findings),
            ...pipelineRunIdPayload,
            ...(escalationReason != null ? { escalationReason } : {}),
          },
          runId,
        });

        if (auditOutcome.autonomyGateFired) {
          await stateSource.comment(
            workItem.externalId,
            buildAgentComment('Review', 'Needs Human', escalationReason ?? 'Audit gate failed', [
              auditOutcome.summaryDetail ?? 'See audit.completed event for full breakdown.',
            ]),
          );
          await stateSource.transitionState(
            workItem.externalId,
            'factory:needs-review',
            'factory:needs-human',
          );
          emitStateTransitionEvent({
            projectId: projectSlug,
            workItemId: workItem.id,
            from: 'factory:needs-review',
            to: 'factory:needs-human',
            by: 'convergent-review',
            runId,
            extraPayload: reviewWorkflowPayload,
          });
          return;
        }

        await stateSource.comment(
          workItem.externalId,
          buildAgentComment(
            'Review',
            'Approved',
            `Converged after ${round} round(s) — advancing to merge-ready`,
            [],
          ),
        );
        await stateSource.transitionState(
          workItem.externalId,
          'factory:needs-review',
          'factory:approved',
        );
        emitStateTransitionEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          from: 'factory:needs-review',
          to: 'factory:approved',
          by: 'convergent-review',
          runId,
          extraPayload: reviewWorkflowPayload,
        });
        return;
      }

      // At round cap with unresolved CRITICAL or unconverged — escalate. Do NOT continue past cap.
      if (round === maxReviewRounds && waveResult.newCriticalFindings.length > 0) {
        const runId = crypto.randomUUID();
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'review.escalated',
          payload: {
            ...reviewWorkflowPayload,
            reason: 'cap-with-new-critical',
            round,
            unconvergedFindingsCount: waveResult.newCriticalFindings.length,
          },
          runId,
        });
        const allFindings = waveResult.reviewerOutputs.flatMap((r) => r.parsed.findings);
        // P2 fix: emit review.completed so downstream consumers see the outcome.
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'review.completed',
          payload: {
            ...reviewWorkflowPayload,
            verdict: 'needs-human',
            confidence: 0,
            criteriaChecks: [],
            findings: allFindings,
            escalationReason: `Failed to converge after ${round} rounds: ${waveResult.newCriticalFindings.length} unresolved CRITICAL finding(s)`,
            ...pipelineRunIdPayload,
          },
          runId,
        });
        const details = waveResult.newCriticalFindings
          .slice(0, 5)
          .map((k) => `[CRITICAL] ${k.ruleId}`);
        await stateSource.comment(
          workItem.externalId,
          buildAgentComment(
            'Review',
            'Needs Human',
            `Failed to converge after ${round} round(s) — ${waveResult.newCriticalFindings.length} unresolved CRITICAL finding(s)`,
            details,
          ),
        );
        await stateSource.transitionState(
          workItem.externalId,
          'factory:needs-review',
          'factory:needs-human',
        );
        emitStateTransitionEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          from: 'factory:needs-review',
          to: 'factory:needs-human',
          by: 'convergent-review',
          runId,
          extraPayload: reviewWorkflowPayload,
        });
        return;
      }
    }

    // Edge case: loop exhausted without convergence or escalation (e.g. maxReviewRounds=0)
    await stateSource.transitionState(
      workItem.externalId,
      'factory:needs-review',
      'factory:needs-human',
    );
    emitStateTransitionEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      from: 'factory:needs-review',
      to: 'factory:needs-human',
      by: 'convergent-review',
      extraPayload: reviewWorkflowPayload,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const catchRunId = crypto.randomUUID();
    eventStore.appendEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { ...reviewWorkflowPayload, error: error.message, skill: 'review' },
      runId: catchRunId,
    });
    await stateSource.comment(
      workItem.externalId,
      buildAgentComment(
        'Review',
        'Failed',
        'Convergent review run failed — escalating to needs-human',
        [`Error: ${error.message}`],
      ),
    );
    await stateSource.transitionState(
      workItem.externalId,
      'factory:needs-review',
      'factory:needs-human',
    );
    emitStateTransitionEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      from: 'factory:needs-review',
      to: 'factory:needs-human',
      by: 'convergent-review',
      runId: catchRunId,
      extraPayload: reviewWorkflowPayload,
    });
  }
}
