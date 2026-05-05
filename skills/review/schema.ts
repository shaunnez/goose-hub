import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

export const CriterionCheckSchema = z.object({
  criterion: z.string(),
  status: z.enum(['met', 'unmet', 'unclear']),
  notes: z.string().optional(),
});

export const ReviewFindingSchema = z.object({
  criterion: z.string().optional(),
  severity: z.enum(['blocker', 'major', 'minor']),
  description: z.string(),
  suggestion: z.string().optional(),
  file: z.string().optional(),
  line: z.number().int().optional(),
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
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;
