import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

export const BugEnhanceOutputSchema = z.object({
  enhancedContent: z
    .string()
    .describe('Structured markdown sections to append after the original bug body'),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type BugEnhanceOutput = z.infer<typeof BugEnhanceOutputSchema>;
