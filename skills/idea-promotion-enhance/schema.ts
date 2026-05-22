import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

export const IdeaPromotionEnhanceOutputSchema = z.object({
  enhancedContent: z
    .string()
    .describe('Structured markdown sections to append after the original promoted idea body'),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type IdeaPromotionEnhanceOutput = z.infer<typeof IdeaPromotionEnhanceOutputSchema>;
