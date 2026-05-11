import { desc, eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { runQualityScores } from '../db/schema.js';
import type { QualityComponents, RunQualityScore } from './types.js';

export function persistRunQualityScore(input: {
  runId: string;
  pipelineRunId?: string | null;
  projectId: string;
  iteration: number;
  score: number;
  components: QualityComponents;
  auditScore?: number | null;
}): void {
  db.insert(runQualityScores)
    .values({
      runId: input.runId,
      pipelineRunId: input.pipelineRunId ?? null,
      projectId: input.projectId,
      iteration: input.iteration,
      score: input.score,
      componentsJson: JSON.stringify(input.components),
      auditScore: input.auditScore ?? null,
    })
    .onConflictDoUpdate({
      target: [runQualityScores.runId, runQualityScores.iteration],
      set: {
        pipelineRunId: input.pipelineRunId ?? null,
        score: input.score,
        componentsJson: JSON.stringify(input.components),
        auditScore: input.auditScore ?? null,
      },
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
