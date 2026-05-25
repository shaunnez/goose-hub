import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';
import { GroundedHintsSchema } from '../bug-enhance/schema.js';

export { DecisionSummarySchema, GroundedHintsSchema };

export const FeatureFrameOutputSchema = z.object({
  framedContent: z
    .string()
    .min(1)
    .describe('Structured markdown scaffold sections to append after the original feature body'),
  refinedIntent: z.string().min(1),
  proposedAcceptanceCriteria: z.array(z.string().min(1)).min(1),
  groundedHints: GroundedHintsSchema.optional(),
  stillNeedsGrilling: z.boolean(),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type FeatureFrameOutput = z.infer<typeof FeatureFrameOutputSchema>;
