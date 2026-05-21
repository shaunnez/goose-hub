import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

const ConfidenceSchema = z.enum(['low', 'medium', 'high']);

const AdvisorVerdictBaseSchema = z.object({
  verdict: z.enum(['proceed', 'revise', 'abort']),
  confidence: ConfidenceSchema,
  feedback: z
    .string()
    .nullable()
    .optional()
    .describe('Concrete feedback the primary must address on retry'),
  reason: z
    .string()
    .nullable()
    .optional()
    .describe('Why this plan is unsafe; surfaced to human reviewer'),
});

function refineAdvisorVerdict(val: z.infer<typeof AdvisorVerdictBaseSchema>, ctx: z.RefinementCtx) {
  if (val.verdict === 'revise') {
    if (typeof val.feedback === 'string' && val.feedback.trim().length > 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'revise verdicts must include non-blank feedback',
      path: ['feedback'],
    });
  }
  if (val.verdict === 'abort') {
    if (typeof val.reason === 'string' && val.reason.trim().length > 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'abort verdicts must include a non-blank reason',
      path: ['reason'],
    });
  }
}

export const AdvisorVerdictSchema = AdvisorVerdictBaseSchema.superRefine(refineAdvisorVerdict);

export const AdviseOnPlanSchema = z
  .object({
    verdict: z.enum(['proceed', 'revise', 'abort']),
    confidence: ConfidenceSchema,
    feedback: z
      .string()
      .nullable()
      .optional()
      .describe('Concrete feedback the primary must address on retry'),
    reason: z
      .string()
      .nullable()
      .optional()
      .describe('Why this plan is unsafe; surfaced to human reviewer'),
    decisionSummaries: z.array(DecisionSummarySchema).min(1),
  })
  .superRefine(refineAdvisorVerdict);

export type AdvisorVerdict = z.infer<typeof AdvisorVerdictSchema>;
export type AdviseOnPlanOutput = z.infer<typeof AdviseOnPlanSchema>;
