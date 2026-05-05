import { DispositionSchema } from '@goose-hub/core/findings/disposition.js';
import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };
export { DispositionSchema };

export const CriterionCheckSchema = z.object({
  criterion: z.string(),
  status: z.enum(['met', 'unmet', 'unclear']),
  notes: z.string().optional(),
});

/**
 * Review finding shape (#468). Disposition is required when severity is
 * `blocker` (the Review-side fix-or-register rule). Shared
 * `DispositionSchema` lives in `core/findings/disposition.ts`.
 */
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
    dispositionRef: z.string().min(1).optional(),
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

export type { Disposition } from '@goose-hub/core/findings/disposition.js';
export type DecisionSummary = z.infer<typeof DecisionSummarySchema>;
export type CriterionCheck = z.infer<typeof CriterionCheckSchema>;
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;
