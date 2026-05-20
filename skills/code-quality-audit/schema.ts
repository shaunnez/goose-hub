import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

// ─── Evidence ──────────────────────────────────────────────────────────────────

export const EvidenceItemSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  note: z.string().min(1),
});

// ─── Scorecard entry for one of the 8 categories ──────────────────────────────

export const ScorecardEntrySchema = z
  .object({
    category: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
      z.literal(8),
    ]),
    name: z.string().min(1),
    score: z.number().int().min(0),
    max: z.number().int().positive(),
    evidence: z.array(EvidenceItemSchema).min(1),
  })
  .superRefine((val, ctx) => {
    if (val.score > val.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `score ${val.score} exceeds max ${val.max} for category ${val.category}`,
        path: ['score'],
      });
    }
  });

// ─── Recommendation ───────────────────────────────────────────────────────────

export const RecommendationSchema = z.object({
  priority: z.enum(['P0', 'P1', 'P2']),
  principle: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  fix: z.string().min(1),
  effort: z.enum(['Low', 'Medium', 'High']),
  impactPoints: z.number().int().min(0),
});

// ─── Overall rating derived from total score ──────────────────────────────────

export const RatingSchema = z.enum(['Exemplary', 'Good', 'NeedsWork', 'Concerning', 'Redesign']);

// ─── Top-level audit output ───────────────────────────────────────────────────

export const CodeQualityAuditOutputSchema = z
  .object({
    scorecard: z.array(ScorecardEntrySchema).length(8),
    rating: RatingSchema,
    strengths: z.array(z.string().min(1)),
    recommendations: z.array(RecommendationSchema),
    mcIlroyQuestion: z.string().min(1),
    projectedScoreAfterTop3: z.number().int().min(0).max(100),
    decisionSummaries: z.array(DecisionSummarySchema).min(1),
  })
  .superRefine((val, ctx) => {
    // Validate total score aligns with rating
    const total = val.scorecard.reduce((sum, e) => sum + e.score, 0);
    const expectedRating = scoreToRating(total);
    if (val.rating !== expectedRating) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `rating '${val.rating}' does not match total score ${total} (expected '${expectedRating}')`,
        path: ['rating'],
      });
    }
    // Validate that projectedScoreAfterTop3 >= total (fixes raise the score)
    if (val.projectedScoreAfterTop3 < total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `projectedScoreAfterTop3 (${val.projectedScoreAfterTop3}) must be >= total score (${total})`,
        path: ['projectedScoreAfterTop3'],
      });
    }
    // At least one P0 recommendation must cite file:line for critical issues
    const p0s = val.recommendations.filter((r) => r.priority === 'P0');
    if (p0s.length > 0 && p0s.every((r) => !r.file)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'P0 recommendations must cite a file',
        path: ['recommendations'],
      });
    }
  });

// ─── Context schema ───────────────────────────────────────────────────────────

export const CodeQualityAuditContextSchema = z.object({
  metricsJson: z
    .object({
      locDiscipline: z.object({ score: z.number(), pctUnder200: z.number() }),
      coupling: z.object({
        score: z.number(),
        avgImports: z.number(),
        maxImports: z.number(),
        maxFile: z.string(),
      }),
      cyclomaticComplexity: z.object({ score: z.number(), pctUnder10: z.number() }),
      fileCount: z.number().int(),
      scannedAt: z.string(),
    })
    .optional(),
  workItem: z
    .object({
      title: z.string(),
      number: z.number(),
    })
    .optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function scoreToRating(total: number): z.infer<typeof RatingSchema> {
  if (total >= 90) return 'Exemplary';
  if (total >= 75) return 'Good';
  if (total >= 55) return 'NeedsWork';
  if (total >= 35) return 'Concerning';
  return 'Redesign';
}

// ─── Exported types ───────────────────────────────────────────────────────────

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export type ScorecardEntry = z.infer<typeof ScorecardEntrySchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type Rating = z.infer<typeof RatingSchema>;
export type CodeQualityAuditOutput = z.infer<typeof CodeQualityAuditOutputSchema>;
export type CodeQualityAuditContext = z.infer<typeof CodeQualityAuditContextSchema>;
