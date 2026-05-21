import { resolveAcceptanceContract } from '@goose-hub/core/acceptance-contracts/resolver.js';
// slices/review/convergent-review.ts
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { assembleSpawnContext } from '@goose-hub/core/agent-runtime/context-assembly.js';
import type { AgentResult, AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { reconcileDecisionSummaries } from '@goose-hub/core/agent-runtime/reconcile-decisions.js';
import { resolveBudgetsForProject } from '@goose-hub/core/agent-runtime/resolve-for-project.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { selectRuntime } from '@goose-hub/core/agent-runtime/select-runtime.js';
import type { ReviewerSlot } from '@goose-hub/core/db/repositories/project-review-settings.js';
import {
  parseReviewerSlots,
  readProjectReviewSettings,
} from '@goose-hub/core/db/repositories/project-review-settings.js';
import { emitStateTransitionEvent } from '@goose-hub/core/event-stream/state-transition.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import { classifyTopic } from '@goose-hub/core/review/topic-classifier.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
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
 * Divergent verdicts (approved + needs-fix) → verdictsDiverge: true.
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
  const resolvedBudgets = resolveBudgetsForProject('review', projectConfig?.budgets, projectSlug);

  // Read configurable slots from DB; fall back to defaults.
  // verdictsDiverge escalation only applies when slots are explicitly configured (not defaults).
  const settingsRow = readProjectReviewSettings(projectConfig?.id ?? projectSlug);
  const configuredSlots = parseReviewerSlots(settingsRow);
  const slots = configuredSlots ?? DEFAULT_REVIEWER_SLOTS;
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
      resolvedBudgets,
      extraEventPayload: {
        reviewWorkflowRunId,
        round,
        slotIndex: i,
        slotModel: slot.model,
        promptVariant: slot.prompt,
      },
    });
  });

  // Route each spawn through assembleSpawnContext to enforce holdout boundary.
  specs.forEach(assembleSpawnContext);

  const rawResults = await Promise.all(
    specs.map((spec, i) =>
      runtimeForSlot(slots[i].model)
        .run(spec)
        .catch((err: unknown) => (err instanceof Error ? err : new Error(String(err)))),
    ),
  );

  const parsed = rawResults.map((r) =>
    r instanceof Error ? null : ReviewOutputSchema.safeParse((r as AgentResult).output),
  );

  const successfulReviewerOutputs = parsed.flatMap((p, i) => {
    if (p == null || !p.success) return [];
    const slot = slots[i];
    return [
      {
        parsed: p.data,
        runId: runIds[i],
        round,
        slotIndex: i,
        slotModel: slot.model,
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

  if (parsed.some((p) => p == null || !p.success)) {
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
      parseFailureError: errors.join('; '),
      anyNeedsHuman: false,
      anyNeedsFix: false,
      verdictsDiverge: false,
    };
  }

  const parsedData = (parsed as Array<{ success: true; data: ReviewOutput }>).map((p) => p.data);
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
  const runtimeForSlot = injectedRuntime
    ? () => injectedRuntime
    : (model: ReviewerSlot['model']) =>
        selectRuntime({ configRuntime: model === 'codex' ? 'codex-cli' : 'claude-cli' });
  const projectConfig = await getProjectBySlug(projectSlug);
  const maxReviewRounds = projectConfig?.maxReviewRounds ?? DEFAULT_MAX_REVIEW_ROUNDS;

  try {
    const prDiff = await stateSource.getPrDiff(workItem.externalId);
    const changedFilePaths = extractChangedFilePaths(prDiff);
    const { minRounds } = classifyTopic(changedFilePaths);
    const qaResult = getQaVerdict(eventStore.replay({ workItemId: workItem.id }));
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

      // P1 fix: a reviewer returning needs-human must escalate immediately (rule 23, holdout).
      if (waveResult.anyNeedsHuman) {
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

      // Divergent verdicts (approved + needs-fix) — immediate escalation (M19.20).
      if (waveResult.verdictsDiverge) {
        const runId = crypto.randomUUID();
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'review.escalated',
          payload: { ...reviewWorkflowPayload, reason: 'divergent-verdicts', round },
          runId,
        });
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'review.completed',
          payload: {
            ...reviewWorkflowPayload,
            verdict: 'needs-human',
            confidence: 0,
            criteriaChecks: [],
            findings: waveResult.reviewerOutputs.flatMap((r) => r.parsed.findings),
            escalationReason: `Round ${round} reviewers returned divergent verdicts — human arbitration required`,
            ...pipelineRunIdPayload,
          },
          runId,
        });
        await stateSource.comment(
          workItem.externalId,
          buildAgentComment(
            'Review',
            'Needs Human',
            `Round ${round} reviewers diverged (approved vs needs-fix) — human arbitration required`,
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

      // P1 fix: needs-fix verdict (even without blockers) prevents convergence counting.
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
