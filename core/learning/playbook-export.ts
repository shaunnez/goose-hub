import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/db.js';
import { archivedLifecycles, decisionPatterns } from '../db/schema.js';
import { computeCostBaselines, computeGateThresholds } from './playbook-stats.js';

// ─── Manifest schema ─────────────────────────────────────────────────────────

export const LearningEntryExportSchema = z.object({
  observation: z.string(),
  rationale: z.string(),
  improvementKind: z.string(),
  targetPath: z.string().optional(),
  confidence: z.string(),
});

export const GateThresholdExportSchema = z.object({
  gateName: z.string(),
  phase: z.string(),
  mean: z.number(),
  min: z.number(),
  max: z.number(),
  stdDev: z.number(),
  sampleCount: z.number().int(),
});

export const DecisionPatternExportSchema = z.object({
  decisionType: z.string(),
  phase: z.string(),
  actionSummary: z.string(),
  reasonSummary: z.string(),
  occurrenceCount: z.number().int(),
  consistencyScore: z.number(),
});

export const CostBaselineExportSchema = z.object({
  phase: z.string(),
  meanUsd: z.number(),
  p50Usd: z.number(),
  p95Usd: z.number(),
  sampleCount: z.number().int(),
});

export const PlaybookManifestSchema = z.object({
  schemaVersion: z.literal('1'),
  generatedAt: z.string(),
  sourceProject: z.string(),
  learnings: z.array(LearningEntryExportSchema),
  gateThresholds: z.array(GateThresholdExportSchema),
  decisionPatterns: z.array(DecisionPatternExportSchema),
  costBaselines: z.array(CostBaselineExportSchema),
});

export type PlaybookManifest = z.infer<typeof PlaybookManifestSchema>;

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Exports a portable `PlaybookManifest` for the given project.
 * No project-specific identifiers (issue numbers, repo paths) leak into the manifest.
 */
export function exportPlaybook(projectId: string, sourceProjectName: string): PlaybookManifest {
  const generatedAt = new Date().toISOString();

  // Collect learning entries from all archived lifecycles (last 90 days)
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const lifecycles = db
    .select()
    .from(archivedLifecycles)
    .where(
      and(eq(archivedLifecycles.projectId, projectId), gte(archivedLifecycles.closedAt, since)),
    )
    .all();

  type RawLearning = {
    observation?: string;
    rationale?: string;
    improvementKind?: string;
    targetPath?: string;
    confidence?: string;
  };
  const learnings: z.infer<typeof LearningEntryExportSchema>[] = [];
  for (const lc of lifecycles) {
    let entries: RawLearning[] = [];
    try {
      entries = JSON.parse(lc.learningEntries) as RawLearning[];
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.observation || !entry.rationale) continue;
      learnings.push({
        observation: entry.observation,
        rationale: entry.rationale,
        improvementKind: entry.improvementKind ?? 'skill-prompt',
        targetPath: entry.targetPath,
        confidence: entry.confidence ?? 'medium',
      });
    }
  }

  // Decision patterns — strip project identifiers, map role → phase
  const patterns = db
    .select()
    .from(decisionPatterns)
    .where(eq(decisionPatterns.projectId, projectId))
    .all();

  const exportedPatterns = patterns.map((p) => ({
    decisionType: p.kind,
    phase: p.role,
    actionSummary: p.actionSummary,
    reasonSummary: p.reasonSummary,
    occurrenceCount: p.occurrenceCount,
    consistencyScore: p.consistencyScore,
  }));

  // Gate thresholds over the same 90-day window
  const windowStartAt = since;
  const windowEndAt = generatedAt;
  const gateStats = computeGateThresholds({ projectId, windowStartAt, windowEndAt });
  const gateThresholds = gateStats.map((g) => ({
    gateName: g.gate,
    phase: g.gate,
    mean: g.mean,
    min: g.min,
    max: g.max,
    stdDev: g.stdDev,
    sampleCount: g.sampleCount,
  }));

  // Cost baselines — map role/skill → phase (role name only, no project refs)
  const rawCosts = computeCostBaselines({ projectId, windowStartAt, windowEndAt });
  const costBaselines = rawCosts.map((c) => ({
    phase: c.role,
    meanUsd: c.mean,
    p50Usd: c.p50,
    p95Usd: c.p95,
    sampleCount: c.sampleCount,
  }));

  return PlaybookManifestSchema.parse({
    schemaVersion: '1',
    generatedAt,
    sourceProject: sourceProjectName,
    learnings,
    gateThresholds,
    decisionPatterns: exportedPatterns,
    costBaselines,
  });
}
