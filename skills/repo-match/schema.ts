import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

export const RepoCandidateSchema = z.object({
  repo: z.string(),
  confidence: z.number().min(0).max(100),
  evidence: z.string(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export const RepoMatchOutputSchema = z.object({
  candidates: z.array(RepoCandidateSchema),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type RepoCandidateOutput = z.infer<typeof RepoCandidateSchema>;
export type RepoMatchOutput = z.infer<typeof RepoMatchOutputSchema>;
