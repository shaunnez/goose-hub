import { ConfidenceSchema, DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export const SkillCoachOutputSchema = z.object({
  skillName: z.string().min(1),
  diagnosis: z.string().min(1),
  proposedPatch: z.string(),
  rationale: z.string().min(1),
  evidencePatternIds: z.array(z.string()),
  confidence: ConfidenceSchema,
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type SkillCoachOutput = z.infer<typeof SkillCoachOutputSchema>;
