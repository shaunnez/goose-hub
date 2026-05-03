import { z } from 'zod';

export const DecisionSummarySchema = z.object({
  step: z.string(),
  summary: z.string(),
  evidence: z.string().optional(),
});

export const FindingSchema = z.object({
  tier: z.enum(['structural', 'functional', 'regression']),
  severity: z.enum(['error', 'warning', 'info']),
  file: z.string().optional(),
  line: z.number().int().optional(),
  description: z.string(),
  suggestion: z.string().optional(),
});

export const TierResultSchema = z.object({
  passed: z.boolean(),
  findings: z.array(FindingSchema),
  command: z.string().optional(),
  output: z.string().optional(),
});

/**
 * 8-category code quality rubric (from Steve's training materials).
 * Maximum aggregate score: 100 points.
 * Pass threshold: >= 70 points.
 */
export const QualityScoresSchema = z.object({
  /** Open/Closed principle adherence — 0–20 pts */
  openClosed: z.number().int().min(0).max(20),
  /** Number of distinct concepts introduced — 0–15 pts */
  conceptCount: z.number().int().min(0).max(15),
  /** Time-to-capability: how quickly a developer can use the code — 0–15 pts */
  timeToCapability: z.number().int().min(0).max(15),
  /** Complecting: mixing unrelated concerns — 0–15 pts */
  complecting: z.number().int().min(0).max(15),
  /** Lines of code: conciseness — 0–10 pts */
  loc: z.number().int().min(0).max(10),
  /** Coupling: dependency strength between modules — 0–10 pts */
  coupling: z.number().int().min(0).max(10),
  /** Gall's Law: avoidance of big-bang complexity — 0–10 pts */
  gallsLaw: z.number().int().min(0).max(10),
  /** Cyclomatic complexity: branching count — 0–5 pts */
  cyclomaticComplexity: z.number().int().min(0).max(5),
});

export const QaOutputSchema = z.object({
  /** Overall QA verdict for the PR */
  verdict: z.enum(['pass', 'fail', 'partial']),
  /** Aggregate quality score (0–100) computed from qualityScores */
  overallScore: z.number().int().min(0).max(100),
  /** Passing threshold — default 70 */
  threshold: z.number().int().default(70),
  /** Results from each of the three verification tiers */
  tierResults: z.object({
    structural: TierResultSchema,
    functional: TierResultSchema,
    regression: TierResultSchema,
  }),
  /** 8-category quality scores */
  qualityScores: QualityScoresSchema,
  /** All findings aggregated across tiers */
  findings: z.array(FindingSchema),
  /** Per-step audit trail of QA decisions */
  decisionSummaries: z.array(DecisionSummarySchema),
});

export type DecisionSummary = z.infer<typeof DecisionSummarySchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type TierResult = z.infer<typeof TierResultSchema>;
export type QualityScores = z.infer<typeof QualityScoresSchema>;
export type QaOutput = z.infer<typeof QaOutputSchema>;

/**
 * Compute the aggregate quality score by summing all 8 category scores.
 * The maximum possible score is 100 (20+15+15+15+10+10+10+5).
 * The pass threshold is 70.
 */
export function computeOverallScore(scores: z.infer<typeof QualityScoresSchema>): number {
  return Object.values(scores).reduce((a, b) => a + b, 0);
}
