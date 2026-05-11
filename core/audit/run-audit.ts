// core/audit/run-audit.ts
// Orchestration glue for the `code-quality-audit` skill (M19.22, #698).
//
// Responsibilities:
//   1. invokeSkill('code-quality-audit') with the supplied worktree + work item
//   2. Compute `audit_score` (sum of the 8-category scorecard, 0..100)
//   3. Persist `audit_score` on the per-cycle `run_quality_scores` row
//      keyed by `pipelineRunId` (M19.21). When no pipelineRunId is supplied
//      (nightly project-level audit), a synthetic pipelineRunId is generated
//      so the row is queryable by the trend UI without confusing it with a
//      real merge-decision row.
//   4. Translate the top-3 recommendations into ImprovementCandidates and
//      hand them off to the persister supplied by the caller (the retro
//      workflow already owns the candidate persistence path; review takes
//      a simpler in-line path).
//   5. Surface an autonomy-gate signal when `audit_score < 60` so callers
//      running in `autonomous` mode can transition to `factory:needs-human`.

import {
  type CodeQualityAuditContext,
  type CodeQualityAuditOutput,
  CodeQualityAuditOutputSchema,
  type Recommendation,
} from '../../skills/code-quality-audit/schema.js';
import { OutputValidationError, invokeSkill } from '../agent-runtime/invoke-skill.js';
import { eventStore } from '../event-stream/store.js';
import {
  getLatestQualityScoreByPipelineRun,
  persistRunQualityScore,
} from '../quality-score/repository.js';
import type { QualityComponents } from '../quality-score/types.js';
import type { ImprovementCandidate } from '../retrospective/schemas.js';

/** Configurable autonomy-gate threshold. Audit scores below this fail the
 * autonomous-mode gate. Issue #698 spec: 60. */
export const AUDIT_AUTONOMY_THRESHOLD = 60;

/** Default empty components used when persisting a project-level nightly
 * audit row — there is no PR cycle to derive QA/Review counts from. */
const EMPTY_COMPONENTS: QualityComponents = {
  p0_count: 0,
  p1_count: 0,
  p2_count: 0,
  p3_count: 0,
  regressions_open: 0,
  review_converged: false,
  uat_passed: false,
  static_passed: false,
  harness_pass_rate: 0,
};

export interface RunAuditInput {
  projectId: string;
  workItemId?: string | null;
  /** Absolute path to the worktree the auditor should inspect. */
  worktreePath: string;
  /** Optional pre-computed metrics for Cat 5/6/8 (LOC, coupling, complexity). */
  metricsJson?: CodeQualityAuditContext['metricsJson'];
  /** Optional work item summary for context. */
  workItem?: { title: string; number: number };
  /** Pipeline run id to attach the audit score to. When omitted a synthetic
   * `nightly-<projectId>-<isoDate>` id is generated. */
  pipelineRunId?: string;
  /** Iteration to write the audit row at. Defaults to 0. */
  iteration?: number;
  /** Trigger label written to the event payload. Helps the timeline + the
   * trend UI distinguish nightly audits from review/retro-attached audits. */
  trigger: 'deep-retro' | 'convergent-review' | 'nightly';
  /** Project mode — drives the autonomy gate. */
  mode: 'interactive' | 'supervised' | 'autonomous';
}

export interface AuditOutcome {
  ok: true;
  /** 0..100 — sum of the 8-category scorecard. */
  auditScore: number;
  /** Synthetic id when no pipeline anchor was supplied. */
  pipelineRunId: string;
  output: CodeQualityAuditOutput;
  /** Up to three ImprovementCandidates derived from the audit's
   * `recommendations` list, sorted by (priority, impactPoints desc). */
  improvementCandidates: ImprovementCandidate[];
  /** True when `auditScore < AUDIT_AUTONOMY_THRESHOLD` AND `mode === 'autonomous'`. */
  autonomyGateFired: boolean;
}

export interface AuditFailure {
  ok: false;
  error: string;
}

export type AuditResult = AuditOutcome | AuditFailure;

/** Priority ordering used to rank `recommendations` before truncating to top 3. */
const PRIORITY_RANK: Record<Recommendation['priority'], number> = { P0: 0, P1: 1, P2: 2 };

function sortRecommendations(list: Recommendation[]): Recommendation[] {
  return [...list].sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (byPriority !== 0) return byPriority;
    // Higher impact first
    return b.impactPoints - a.impactPoints;
  });
}

/** Map a McIlroy-style audit recommendation to the closest existing
 * `ImprovementKind`. The audit only surfaces architectural fixes, so the
 * mapping is structural: anything that mentions "skill"/"prompt" routes to
 * `skill-prompt`; anything mentioning "config" routes to `skill-config`;
 * everything else is a `workflow` change (the default architectural lever). */
export function mapPrincipleToKind(principle: string): ImprovementCandidate['kind'] {
  const p = principle.toLowerCase();
  if (p.includes('prompt') || p.includes('skill prompt')) return 'skill-prompt';
  if (p.includes('schema')) return 'skill-schema';
  if (p.includes('config')) return 'skill-config';
  if (p.includes('governance')) return 'governance-suggestion';
  return 'workflow';
}

function recommendationConfidence(r: Recommendation): ImprovementCandidate['confidence'] {
  if (r.priority === 'P0') return 'high';
  if (r.priority === 'P1') return 'medium';
  return 'low';
}

export function buildImprovementCandidates(
  output: CodeQualityAuditOutput,
  sourcePersonaId?: string,
): ImprovementCandidate[] {
  const top3 = sortRecommendations(output.recommendations).slice(0, 3);
  return top3.map((r) => ({
    kind: mapPrincipleToKind(r.principle),
    targetPath: r.file,
    suggestionText: `[${r.priority}] ${r.principle} — ${r.fix} (effort: ${r.effort}, impact: +${r.impactPoints})`,
    confidence: recommendationConfidence(r),
    ...(sourcePersonaId != null ? { sourcePersonaId } : {}),
  }));
}

export function computeAuditScore(output: CodeQualityAuditOutput): number {
  return output.scorecard.reduce((sum, entry) => sum + entry.score, 0);
}

function syntheticNightlyPipelineRunId(projectId: string, when: Date): string {
  const iso = when.toISOString().slice(0, 10);
  return `nightly-${projectId}-${iso}`;
}

/** Public entry point. See module header for the contract. */
export async function runCodeQualityAudit(input: RunAuditInput): Promise<AuditResult> {
  const runId = crypto.randomUUID();
  const pipelineRunId =
    input.pipelineRunId ?? syntheticNightlyPipelineRunId(input.projectId, new Date());

  const context: Record<string, unknown> = { worktreePath: input.worktreePath };
  if (input.metricsJson != null) context.metricsJson = input.metricsJson;
  if (input.workItem != null) context.workItem = input.workItem;

  let output: CodeQualityAuditOutput;
  try {
    const result = await invokeSkill({
      skillName: 'code-quality-audit',
      projectId: input.projectId,
      workItemId: input.workItemId ?? undefined,
      runId,
      context,
      overrides: {
        extraEventPayload: { trigger: input.trigger, pipelineRunId },
      },
    });
    const parsed = CodeQualityAuditOutputSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new OutputValidationError(
        parsed.error.issues.map((i) => ({
          path: i.path as Array<string | number>,
          message: i.message,
        })),
        'code-quality-audit',
        runId,
      );
    }
    output = parsed.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItemId ?? null,
      kind: 'audit.failed',
      payload: { runId, trigger: input.trigger, pipelineRunId, error: message },
      runId,
    });
    return { ok: false, error: message };
  }

  const auditScore = computeAuditScore(output);
  const iteration = input.iteration ?? 0;

  // Persist on the existing per-cycle score row when one exists. If not
  // (project-level nightly), insert a fresh row using the synthetic
  // pipelineRunId — components are zeroed because no PR cycle anchors them.
  const existing = getLatestQualityScoreByPipelineRun(pipelineRunId);
  persistRunQualityScore({
    runId: existing?.runId ?? pipelineRunId,
    pipelineRunId,
    projectId: input.projectId,
    iteration: existing?.iteration ?? iteration,
    score: existing?.score ?? 0,
    components: existing?.components ?? EMPTY_COMPONENTS,
    auditScore,
  });

  const improvementCandidates = buildImprovementCandidates(output);
  const autonomyGateFired = auditScore < AUDIT_AUTONOMY_THRESHOLD && input.mode === 'autonomous';

  eventStore.appendEvent({
    projectId: input.projectId,
    workItemId: input.workItemId ?? null,
    kind: 'audit.completed',
    payload: {
      runId,
      trigger: input.trigger,
      pipelineRunId,
      auditScore,
      rating: output.rating,
      recommendationCount: output.recommendations.length,
      improvementCandidateCount: improvementCandidates.length,
      autonomyGateFired,
    },
    runId,
  });

  if (autonomyGateFired) {
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItemId ?? null,
      kind: 'audit.autonomy-gate-fired',
      payload: {
        runId,
        pipelineRunId,
        auditScore,
        threshold: AUDIT_AUTONOMY_THRESHOLD,
        trigger: input.trigger,
      },
      runId,
    });
  }

  return {
    ok: true,
    auditScore,
    pipelineRunId,
    output,
    improvementCandidates,
    autonomyGateFired,
  };
}
