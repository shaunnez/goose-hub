import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { runQualityScores } from '../db/schema.js';
import type { QualityComponents, RunQualityScore } from './types.js';

/**
 * Writes (or updates) the per-cycle quality-score row. `auditScore` follows
 * preserve-on-omit semantics: callers that don't pass it (or pass undefined)
 * leave any previously persisted value intact. Pass `null` explicitly to
 * clear the column. M19.22 (#698) — audit and merge-decision write to the
 * same row at different stages of the cycle, so they must not clobber each
 * other.
 */
export function persistRunQualityScore(input: {
  runId: string;
  pipelineRunId?: string | null;
  projectId: string;
  iteration: number;
  score: number;
  components: QualityComponents;
  auditScore?: number | null;
}): void {
  const auditExplicit = 'auditScore' in input && input.auditScore !== undefined;
  const auditValue = auditExplicit ? (input.auditScore as number | null) : null;

  db.insert(runQualityScores)
    .values({
      runId: input.runId,
      pipelineRunId: input.pipelineRunId ?? null,
      projectId: input.projectId,
      iteration: input.iteration,
      score: input.score,
      componentsJson: JSON.stringify(input.components),
      auditScore: auditValue,
    })
    .onConflictDoUpdate({
      target: [runQualityScores.runId, runQualityScores.iteration],
      set: {
        pipelineRunId: input.pipelineRunId ?? null,
        score: input.score,
        componentsJson: JSON.stringify(input.components),
        // Preserve the existing audit_score when the caller omits it. Only
        // an explicit null clears the column.
        ...(auditExplicit ? { auditScore: auditValue } : {}),
      },
    })
    .run();
}

/**
 * Update only the `audit_score` column on the row identified by
 * `(runId, iteration)`. Returns true when a row was updated, false when the
 * row does not exist (audit fires before merge-decision creates the row).
 * M19.22 (#698) — keeps the score/components untouched.
 */
export function updateAuditScore(input: {
  runId: string;
  iteration: number;
  auditScore: number;
}): boolean {
  const result = db
    .update(runQualityScores)
    .set({ auditScore: input.auditScore })
    .where(
      and(eq(runQualityScores.runId, input.runId), eq(runQualityScores.iteration, input.iteration)),
    )
    .run();
  return result.changes > 0;
}

/**
 * Update only `audit_score` for a row keyed by `pipelineRunId`. Returns the
 * number of rows updated. M19.22 (#698) — audit and merge-decision use the
 * pipelineRunId as the durable anchor.
 */
export function updateAuditScoreByPipelineRun(input: {
  pipelineRunId: string;
  auditScore: number;
}): number {
  const result = db
    .update(runQualityScores)
    .set({ auditScore: input.auditScore })
    .where(eq(runQualityScores.pipelineRunId, input.pipelineRunId))
    .run();
  return result.changes;
}

/** Bare INSERT used by run-audit when no row yet exists for the
 * `pipelineRunId`. Distinct from `persistRunQualityScore` to keep the
 * audit-only row semantics explicit: synthetic score=0/components stay
 * tagged via `pipelineRunId` so the project trend can filter them out. */
export function insertAuditOnlyRow(input: {
  runId: string;
  pipelineRunId: string;
  projectId: string;
  iteration: number;
  auditScore: number;
}): void {
  db.insert(runQualityScores)
    .values({
      runId: input.runId,
      pipelineRunId: input.pipelineRunId,
      projectId: input.projectId,
      iteration: input.iteration,
      score: 0,
      componentsJson: JSON.stringify({
        p0_count: 0,
        p1_count: 0,
        p2_count: 0,
        p3_count: 0,
        regressions_open: 0,
        review_converged: false,
        uat_passed: false,
        static_passed: false,
        harness_pass_rate: 0,
      }),
      auditScore: input.auditScore,
    })
    .onConflictDoUpdate({
      target: [runQualityScores.runId, runQualityScores.iteration],
      set: { auditScore: input.auditScore },
    })
    .run();
}

function toRunQualityScore(r: {
  runId: string;
  pipelineRunId: string | null;
  projectId: string;
  iteration: number;
  score: number;
  componentsJson: string;
  auditScore: number | null;
  ts: string;
}): RunQualityScore {
  return {
    runId: r.runId,
    pipelineRunId: r.pipelineRunId,
    projectId: r.projectId,
    iteration: r.iteration,
    score: r.score,
    components: JSON.parse(r.componentsJson) as QualityComponents,
    auditScore: r.auditScore,
    ts: r.ts,
  };
}

export function listRunQualityScores(runId: string): RunQualityScore[] {
  return db
    .select()
    .from(runQualityScores)
    .where(eq(runQualityScores.runId, runId))
    .orderBy(runQualityScores.iteration)
    .all()
    .map(toRunQualityScore);
}

export function listProjectQualityTrend(projectId: string, limit = 50): RunQualityScore[] {
  return db
    .select()
    .from(runQualityScores)
    .where(eq(runQualityScores.projectId, projectId))
    .orderBy(desc(runQualityScores.ts))
    .limit(limit)
    .all()
    .map(toRunQualityScore)
    .reverse();
}

/**
 * Latest score for a single agent run. Used by the roster service to drill
 * into a persona's run history (M19.21 #697).
 */
export function getLatestQualityScoreForRun(runId: string): RunQualityScore | null {
  const rows = db
    .select()
    .from(runQualityScores)
    .where(eq(runQualityScores.runId, runId))
    .orderBy(desc(runQualityScores.iteration))
    .limit(1)
    .all();
  return rows.length === 0 ? null : toRunQualityScore(rows[0]);
}

/**
 * Latest score for a pipeline lifecycle (M19.21 #697). The merge-decision
 * gate writes one row per pipeline (iteration 0 by default); retros and the
 * convergence trend read the same row by `pipelineRunId`.
 */
export function getLatestQualityScoreByPipelineRun(pipelineRunId: string): RunQualityScore | null {
  const rows = db
    .select()
    .from(runQualityScores)
    .where(eq(runQualityScores.pipelineRunId, pipelineRunId))
    .orderBy(desc(runQualityScores.iteration))
    .limit(1)
    .all();
  return rows.length === 0 ? null : toRunQualityScore(rows[0]);
}
