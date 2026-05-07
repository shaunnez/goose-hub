import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

export const GrillMeOutputSchema = z.object({
  questions: z.array(z.string()).max(1),
  refinedIntent: z.string(),
  readyForPRD: z.boolean(),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type GrillMeOutput = z.infer<typeof GrillMeOutputSchema>;
