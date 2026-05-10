import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import { CodexCliRuntime } from '@goose-hub/core/agent-runtime/codex-cli.js';
import { assembleSpawnContext } from '@goose-hub/core/agent-runtime/context-assembly.js';
import type {
  AgentResult,
  AgentRuntime,
  AgentSpec,
} from '@goose-hub/core/agent-runtime/interface.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { reconcileDecisionSummaries } from '@goose-hub/core/agent-runtime/reconcile-decisions.js';
import { resolveBudgetsForProject } from '@goose-hub/core/agent-runtime/resolve-for-project.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import {
  type ReviewerSlot,
  parseReviewerSlots,
  readProjectReviewSettings,
} from '@goose-hub/core/db/repositories/project-review-settings.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import { DEFAULT_MAX_RETRIES, shouldEscalateReview } from '@goose-hub/core/retry/retry-counter.js';
import { classifyTopic } from '@goose-hub/core/review/topic-classifier.js';
import type { StateName } from '@goose-hub/core/state-machine/states.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { ReviewOutputSchema } from '@goose-hub/skills/review/schema.js';
import type { ReviewOutput } from '@goose-hub/skills/review/schema.js';

export interface ReviewWorkflowDeps {
  runtime?: AgentRuntime;
}

/**
 * Runs the Review holdout workflow for a work item in `factory:needs-review` state.
 * Reviewer is a holdout: fresh context, no advisor, no fallback (FACTORY_RULES 1, 20, 23).
 *
 * State transitions:
 *   factory:needs-review → factory:approved   (verdict: approved)
 *   factory:needs-review → factory:needs-fix  (verdict: needs-fix)
 *   factory:needs-review → factory:needs-human (verdict: needs-human OR runtime error)
 */
export async function runReviewWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  projectSlug: string,
  _targetRepo: string,
  deps: ReviewWorkflowDeps = {},
): Promise<void> {
  const runId = crypto.randomUUID();
  const projectConfig = await getProjectBySlug(projectSlug);
  const runtime = deps.runtime ?? new ClaudeCliRuntime();
  const reviewPrompt = readPromptWithContext('review', projectSlug);
  const reviewJsonSchema = toJsonSchema(ReviewOutputSchema);
  const { personaId } = selectPersona(projectSlug, 'reviewer');

  // Snapshot prior events BEFORE this run's outcome is appended (same pattern as QA workflow).
  const priorEvents = eventStore.replay({ workItemId: workItem.id });

  try {
    const prDiff = await getPrDiff(workItem, stateSource);
    const qaVerdict = getQaVerdict(priorEvents);

    const spec = buildReviewSpec({
      runId,
      projectSlug,
      workItem,
      prDiff,
      qaResult: qaVerdict,
      personaId,
      reviewPrompt,
      reviewJsonSchema,
      resolvedBudgets: resolveBudgetsForProject('review', projectConfig?.budgets, projectSlug),
    });
    const result = await runtime.run(spec);

    const parsed = ReviewOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new Error(`Review output validation failed: ${JSON.stringify(parsed.error.issues)}`);
    }
    const reviewOutput = parsed.data;

    const { decisionSummaries: _ds, ...reviewPayload } = reviewOutput;
    eventStore.appendEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      kind: 'review.completed',
      payload: reviewPayload,
      runId,
    });

    reconcileDecisionSummaries(
      runId,
      projectSlug,
      workItem.id,
      'review',
      reviewOutput.decisionSummaries,
    );

    let nextState: StateName;
    if (reviewOutput.verdict === 'needs-fix') {
      // Use priorEvents (snapshotted before this run) for retry count.
      const needsEscalation = shouldEscalateReview(priorEvents);
      nextState = needsEscalation ? 'factory:needs-human' : 'factory:needs-fix';
      if (needsEscalation) {
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'agent.retry-escalated',
          payload: { stage: 'review', maxRetries: DEFAULT_MAX_RETRIES, runId },
          runId,
        });
      }
    } else {
      const VERDICT_TO_STATE: Record<string, StateName> = {
        approved: 'factory:approved',
        'needs-human': 'factory:needs-human',
      };
      nextState = VERDICT_TO_STATE[reviewOutput.verdict] ?? 'factory:needs-human';
    }

    const comment = buildReviewComment(reviewOutput, nextState);
    await stateSource.comment(workItem.externalId, comment);

    accumulatePersonaStats({
      personaName: personaId,
      role: 'reviewer',
      outcome: reviewOutput.verdict === 'approved' ? 'success' : 'failure',
      qualityScore: reviewOutput.confidence,
    });
    await stateSource.transitionState(workItem.externalId, 'factory:needs-review', nextState);
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'reviewer', outcome: 'failure' });
    const error = err instanceof Error ? err : new Error(String(err));

    eventStore.appendEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { runId, error: error.message, skill: 'review' },
      runId,
    });

    await stateSource.comment(
      workItem.externalId,
      buildAgentComment('Review', 'Failed', 'Review run failed — escalating to needs-human', [
        `Error: ${error.message}`,
      ]),
    );
    await stateSource.transitionState(
      workItem.externalId,
      'factory:needs-review',
      'factory:needs-human',
    );
  }
}

async function getPrDiff(workItem: WorkItem, stateSource: StateSource): Promise<string> {
  return stateSource.getPrDiff(workItem.externalId);
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

// ─── Convergent adversarial review (M19.04) ──────────────────────────────────

const DEFAULT_MAX_REVIEW_ROUNDS = 3;

/** Composite deduplication key for a review finding. Maps `description` as ruleId surrogate. */
export interface FindingKey {
  file: string;
  line: number;
  ruleId: string;
  isCritical: boolean;
}

export interface ReviewWaveResult {
  roundFindings: FindingKey[];
  newCriticalFindings: FindingKey[];
  reviewerOutputs: Array<{ parsed: ReviewOutput; runId: string }>;
  parseFailure: boolean;
  parseFailureError?: string;
  /** True if any reviewer returned verdict: 'needs-human' — must escalate immediately. */
  anyNeedsHuman: boolean;
  /** True if any reviewer returned verdict: 'needs-fix' — prevents convergence counting. */
  anyNeedsFix: boolean;
  /** True when some reviewers approved and others returned needs-fix — escalate immediately. */
  verdictsDiverge: boolean;
}

export interface DispatchReviewWaveOpts {
  pr: { externalId: string; prDiff: string };
  qaResult?: { verdict: string; overallScore: number };
  round: number;
  /** Findings from the immediately prior round (empty for round 1). */
  priorFindings: FindingKey[];
  workItem: WorkItem;
  projectSlug: string;
  /** Returns the runtime to use for a given slot model. */
  runtimeForSlot: (model: ReviewerSlot['model']) => AgentRuntime;
}

function toFindingKey(f: {
  file?: string;
  line?: number;
  description: string;
  severity: string;
}): FindingKey {
  return {
    file: f.file ?? '',
    line: f.line ?? -1,
    ruleId: f.description,
    isCritical: f.severity === 'blocker',
  };
}

function findingKeyStr(k: FindingKey): string {
  return JSON.stringify([k.file, k.line, k.ruleId]);
}

function deduplicateFindings(
  findings: Array<{ file?: string; line?: number; description: string; severity: string }>,
): FindingKey[] {
  const seen = new Set<string>();
  const result: FindingKey[] = [];
  for (const f of findings) {
    const key = toFindingKey(f);
    const str = findingKeyStr(key);
    if (!seen.has(str)) {
      seen.add(str);
      result.push(key);
    }
  }
  return result;
}

function extractChangedFilePaths(prDiff: string): string[] {
  const paths: string[] = [];
  for (const line of prDiff.split('\n')) {
    const m = line.match(/^diff --git a\/.+ b\/(.+)$/);
    if (m?.[1] != null) paths.push(m[1]);
  }
  return paths;
}

/** Default reviewer slots: constrained + unconstrained, both on claude. */
const DEFAULT_REVIEWER_SLOTS: ReviewerSlot[] = [
  { model: 'claude', prompt: 'default' },
  { model: 'claude', prompt: 'unconstrained' },
];

/** Shared spec builder for both single and convergent review paths. */
function buildReviewSpec(params: {
  runId: string;
  projectSlug: string;
  workItem: WorkItem;
  prDiff: string;
  qaResult?: { verdict: string; overallScore: number };
  personaId: string;
  reviewPrompt: string;
  reviewJsonSchema: Record<string, unknown>;
  resolvedBudgets: ReturnType<typeof resolveBudgetsForProject>;
  extraEventPayload?: Record<string, unknown>;
}): AgentSpec {
  return {
    runId: params.runId,
    role: 'reviewer',
    skill: 'review',
    context: {
      projectId: params.projectSlug,
      workItemId: params.workItem.id,
      workItem: {
        title: params.workItem.title,
        body: params.workItem.body,
        number: Number(params.workItem.externalId),
      },
      prDiff: params.prDiff,
      qaVerdict: params.qaResult,
    },
    contextAllowlist: ['workItem', 'prDiff', 'qaVerdict'],
    freshContext: true,
    toolBundles: ['read', 'validate'],
    toolExtras: [],
    ...params.resolvedBudgets,
    personaId: params.personaId,
    outputJsonSchema: params.reviewJsonSchema,
    appendSystemPrompt: params.reviewPrompt,
    extraEventPayload: params.extraEventPayload,
  };
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
  const { pr, qaResult, round, priorFindings, workItem, projectSlug, runtimeForSlot } = opts;

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
      personaId: personaIds[i],
      reviewPrompt,
      reviewJsonSchema,
      resolvedBudgets,
      extraEventPayload: { round, slotModel: slot.model, promptVariant: slot.prompt },
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
    reviewerOutputs: parsedData.map((d, i) => ({ parsed: d, runId: runIds[i] })),
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
  deps: ReviewWorkflowDeps = {},
): Promise<void> {
  const injectedRuntime = deps.runtime;
  const runtimeForSlot = injectedRuntime
    ? () => injectedRuntime
    : (model: ReviewerSlot['model']) =>
        model === 'codex' ? new CodexCliRuntime() : new ClaudeCliRuntime();
  const projectConfig = await getProjectBySlug(projectSlug);
  const maxReviewRounds = projectConfig?.maxReviewRounds ?? DEFAULT_MAX_REVIEW_ROUNDS;

  try {
    const prDiff = await stateSource.getPrDiff(workItem.externalId);
    const changedFilePaths = extractChangedFilePaths(prDiff);
    const { minRounds } = classifyTopic(changedFilePaths);
    const qaResult = getQaVerdict(eventStore.replay({ workItemId: workItem.id }));
    const pr = { externalId: workItem.externalId, prDiff };

    let previousRoundFindings: FindingKey[] = [];
    let consecutiveZeroCriticalRounds = 0;

    for (let round = 1; round <= maxReviewRounds; round++) {
      const waveResult = await dispatchReviewWave({
        pr,
        qaResult,
        round,
        priorFindings: previousRoundFindings,
        workItem,
        projectSlug,
        runtimeForSlot,
      });

      if (waveResult.parseFailure) {
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'review.wave-failed',
          payload: { round, error: waveResult.parseFailureError },
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
        return;
      }

      eventStore.appendEvent({
        projectId: projectSlug,
        workItemId: workItem.id,
        kind: 'review.wave-completed',
        payload: {
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
          payload: { reason: 'reviewer-needs-human', round, escalationReason },
          runId,
        });
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'review.completed',
          payload: {
            verdict: 'needs-human',
            confidence: humanReviewer?.parsed.confidence ?? 0,
            criteriaChecks: humanReviewer?.parsed.criteriaChecks ?? [],
            findings: humanReviewer?.parsed.findings ?? [],
            escalationReason,
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
        return;
      }

      // Divergent verdicts (approved + needs-fix) — immediate escalation (M19.20).
      if (waveResult.verdictsDiverge) {
        const runId = crypto.randomUUID();
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'review.escalated',
          payload: { reason: 'divergent-verdicts', round },
          runId,
        });
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'review.completed',
          payload: {
            verdict: 'needs-human',
            confidence: 0,
            criteriaChecks: [],
            findings: waveResult.reviewerOutputs.flatMap((r) => r.parsed.findings),
            escalationReason: `Round ${round} reviewers returned divergent verdicts — human arbitration required`,
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
          payload: { totalRounds: round },
          runId,
        });
        // P2 fix: emit canonical review.completed so UI and fix-feedback loop can consume it.
        eventStore.appendEvent({
          projectId: projectSlug,
          workItemId: workItem.id,
          kind: 'review.completed',
          payload: {
            verdict: 'approved',
            confidence: avgConfidence,
            criteriaChecks: [],
            findings: lastOutputs.flatMap((r) => r.parsed.findings),
          },
          runId,
        });
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
            verdict: 'needs-human',
            confidence: 0,
            criteriaChecks: [],
            findings: allFindings,
            escalationReason: `Failed to converge after ${round} rounds: ${waveResult.newCriticalFindings.length} unresolved CRITICAL finding(s)`,
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
        return;
      }
    }

    // Edge case: loop exhausted without convergence or escalation (e.g. maxReviewRounds=0)
    await stateSource.transitionState(
      workItem.externalId,
      'factory:needs-review',
      'factory:needs-human',
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    eventStore.appendEvent({
      projectId: projectSlug,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { error: error.message, skill: 'review' },
      runId: crypto.randomUUID(),
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
  }
}

function buildReviewComment(
  output: {
    verdict: string;
    confidence: number;
    criteriaChecks: Array<{ criterion: string; status: string }>;
    findings: Array<{ severity: string; description: string }>;
  },
  nextState: string,
): string {
  const statusMap: Record<string, string> = {
    approved: 'Approved',
    'needs-fix': 'Needs Fix',
    'needs-human': 'Needs Human',
  };
  const status = statusMap[output.verdict] ?? output.verdict;
  const pct = Math.round(output.confidence * 100);
  const details = [
    ...output.criteriaChecks.map((c) => `[${c.status === 'met' ? 'x' : ' '}] ${c.criterion}`),
    ...output.findings.slice(0, 5).map((f) => `[${f.severity}] ${f.description}`),
  ];
  return buildAgentComment(
    'Review',
    status,
    `Confidence ${pct}% — transitioning to ${nextState}`,
    details.length > 0 ? details : undefined,
  );
}
