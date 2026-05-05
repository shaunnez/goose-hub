import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

export const CriterionCheckSchema = z.object({
  criterion: z.string(),
  status: z.enum(['met', 'unmet', 'unclear']),
  notes: z.string().optional(),
});

/**
 * Disposition for a Review finding (#468). Mirrors `skills/qa/schema.ts`:
 * every blocker-severity finding must be classified — fixed in this PR,
 * registered as a follow-up issue, or explicitly out-of-scope.
 */
export const DispositionSchema = z.enum(['fixed', 'registered', 'out-of-scope']);

export const ReviewFindingSchema = z
  .object({
    criterion: z.string().optional(),
    severity: z.enum(['blocker', 'major', 'minor']),
    description: z.string(),
    suggestion: z.string().optional(),
    file: z.string().optional(),
    line: z.number().int().optional(),
    /** Disposition required when severity === 'blocker' (#468) */
    disposition: DispositionSchema.optional(),
    /** Commit SHA, issue number, or rationale matching the disposition (#468) */
    dispositionRef: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.severity === 'blocker') {
      if (val.disposition == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'blocker-severity findings must declare a disposition (fix-or-register, #468)',
          path: ['disposition'],
        });
      }
      if (val.dispositionRef == null || val.dispositionRef.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'blocker-severity findings must include dispositionRef (commit SHA, issue #, or rationale, #468)',
          path: ['dispositionRef'],
        });
      }
    }
  });

/**
 * Discriminated union on `verdict` so that `needs-human` REQUIRES
 * `escalationReason` — the other two verdicts do not have this field.
 */
export const ReviewOutputSchema = z.discriminatedUnion('verdict', [
  z.object({
    verdict: z.literal('approved'),
    confidence: z.number().min(0).max(1),
    criteriaChecks: z.array(CriterionCheckSchema),
    findings: z.array(ReviewFindingSchema),
    decisionSummaries: z.array(DecisionSummarySchema),
  }),
  z.object({
    verdict: z.literal('needs-fix'),
    confidence: z.number().min(0).max(1),
    criteriaChecks: z.array(CriterionCheckSchema),
    findings: z.array(ReviewFindingSchema),
    decisionSummaries: z.array(DecisionSummarySchema),
  }),
  z.object({
    verdict: z.literal('needs-human'),
    confidence: z.number().min(0).max(1),
    criteriaChecks: z.array(CriterionCheckSchema),
    findings: z.array(ReviewFindingSchema),
    decisionSummaries: z.array(DecisionSummarySchema),
    escalationReason: z.string().min(1),
  }),
]);

export type DecisionSummary = z.infer<typeof DecisionSummarySchema>;
export type CriterionCheck = z.infer<typeof CriterionCheckSchema>;
export type Disposition = z.infer<typeof DispositionSchema>;
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;
