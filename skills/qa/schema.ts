import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

/**
 * Disposition for a QA finding (#468). Every error-severity finding must be
 * one of these — no deferral, no "TODO". Warnings/info findings may carry a
 * disposition but it's optional.
 *
 * - `fixed`: addressed in this PR. `dispositionRef` carries the commit SHA.
 * - `registered`: filed as a follow-up issue. `dispositionRef` carries the
 *   issue number (e.g. "#234").
 * - `out-of-scope`: not in scope for this issue. `dispositionRef` carries a
 *   one-sentence rationale.
 */
export const DispositionSchema = z.enum(['fixed', 'registered', 'out-of-scope']);

export const FindingSchema = z
  .object({
    tier: z
      .string()
      .transform((s) => s.toLowerCase())
      .pipe(z.enum(['structural', 'functional', 'regression'])),
    severity: z.enum(['error', 'warning', 'info']),
    file: z.string().nullable().optional(),
    line: z.number().int().nullable().optional(),
    description: z.string(),
    suggestion: z.string().optional(),
    /** Disposition required when severity === 'error' (#468) */
    disposition: DispositionSchema.optional(),
    /** Commit SHA, issue number, or rationale matching the disposition (#468) */
    dispositionRef: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.severity === 'error') {
      if (val.disposition == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'error-severity findings must declare a disposition (fix-or-register, #468)',
          path: ['disposition'],
        });
      }
      if (val.dispositionRef == null || val.dispositionRef.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'error-severity findings must include dispositionRef (commit SHA, issue #, or rationale, #468)',
          path: ['dispositionRef'],
        });
      }
    }
  });

export const TierResultSchema = z.object({
  passed: z.boolean(),
  findings: z.array(FindingSchema),
  command: z.string().nullable().optional(),
  output: z.string().nullable().optional(),
});

/**
 * 8-category code quality rubric (from Steve's training materials).
 * Maximum aggregate score: 100 points.
 * Pass threshold: >= 70 points.
 */
export const SuiteResultSchema = z.object({
  name: z.string(),
  filePath: z.string(),
  total: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  skipped: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  status: z.enum(['passed', 'failed', 'skipped']),
});

export const TestRunSchema = z.object({
  wallTimeMs: z.number().int().min(0),
  total: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  skipped: z.number().int().min(0),
  success: z.boolean(),
  suites: z.array(SuiteResultSchema),
});

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

export const CriteriaResultSchema = z.object({
  ac: z.string(),
  command: z.string(),
  expected: z.string(),
  actual: z.string(),
  tolerance: z.string(),
  passed: z.boolean(),
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
  /**
   * Optional: per-AC verify-command results. One entry per AC that had a
   * Verify/Expected/Tolerance block in the issue body. Any `passed: false`
   * here forces verdict = 'fail' regardless of tier scores.
   */
  criteriaResults: z.array(CriteriaResultSchema).optional(),
  /**
   * Optional: structured test-run data. The QA workflow runs the test
   * command itself and attaches this; the agent does not need to
   * populate it (and shouldn't — it's overwritten on the workflow side
   * after the run validates).
   */
  testRun: TestRunSchema.optional(),
});

export type DecisionSummary = z.infer<typeof DecisionSummarySchema>;
export type Disposition = z.infer<typeof DispositionSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type TierResult = z.infer<typeof TierResultSchema>;
export type QualityScores = z.infer<typeof QualityScoresSchema>;
export type SuiteResult = z.infer<typeof SuiteResultSchema>;
export type TestRun = z.infer<typeof TestRunSchema>;
export type CriteriaResult = z.infer<typeof CriteriaResultSchema>;
export type QaOutput = z.infer<typeof QaOutputSchema>;

/**
 * Compute the aggregate quality score by summing all 8 category scores.
 * The maximum possible score is 100 (20+15+15+15+10+10+10+5).
 * The pass threshold is 70.
 */
export function computeOverallScore(scores: z.infer<typeof QualityScoresSchema>): number {
  return Object.values(scores).reduce((a, b) => a + b, 0);
}
