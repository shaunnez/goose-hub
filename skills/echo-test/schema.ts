import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

export const EchoOutputSchema = z.object({
  echo: z.string(),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type EchoOutput = z.infer<typeof EchoOutputSchema>;
