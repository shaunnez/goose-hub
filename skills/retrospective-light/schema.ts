import {
  DecisionSummarySchema,
  ImprovementCandidateSchema,
} from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export const LightRetroSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe('3-bullet markdown summary: what went well, what did not, main takeaway'),
  improvementCandidates: z
    .array(ImprovementCandidateSchema)
    .describe('Obvious high-confidence improvement candidates only'),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type LightRetroOutput = z.infer<typeof LightRetroSchema>;
