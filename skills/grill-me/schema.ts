import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

export const GrillMeOutputSchema = z.object({
  questions: z
    .array(
      z.object({
        text: z.string(),
        recommendedAnswer: z.string().optional(),
      }),
    )
    .max(1),
  refinedIntent: z.string(),
  readyForPRD: z.boolean(),
  crystallizedDecision: z.string().optional(),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type GrillMeOutput = z.infer<typeof GrillMeOutputSchema>;
