import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

export const IssueEnhanceOutputSchema = z.object({
  enhancedContent: z
    .string()
    .describe('Structured markdown sections to append after the original issue body'),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type IssueEnhanceOutput = z.infer<typeof IssueEnhanceOutputSchema>;
