import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

export const SprintReviewOutputSchema = z.object({
  milestoneTitle: z.string().min(1),
  shipped: z.array(z.string()),
  deferred: z.array(z.string()),
  retroThemes: z.array(z.string()),
  nextSprintSuggestions: z.array(z.string()),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type SprintReviewOutput = z.infer<typeof SprintReviewOutputSchema>;
