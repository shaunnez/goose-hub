import {
  DecisionPatternSchema,
  DecisionSummarySchema,
  ImprovementCandidateSchema,
  LearningEntrySchema,
  QualityScoreSchema,
} from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { ImprovementCandidateSchema };

export const DeepRetroSchema = z.object({
  summary: z.string().min(1).describe('3-bullet summary of what went well, what did not, and why'),
  personaAnalysis: z
    .array(QualityScoreSchema)
    .describe('Quality scores per persona active in this run'),
  learningEntries: z
    .array(LearningEntrySchema)
    .describe('Normalized observations derived from agent decisions'),
  decisionPatterns: z
    .array(DecisionPatternSchema)
    .describe('Recurring patterns detected across decision records'),
  improvementCandidates: z
    .array(ImprovementCandidateSchema)
    .describe('Surfaced candidates for prompt, skill, or config changes'),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type DeepRetroOutput = z.infer<typeof DeepRetroSchema>;
export type ImprovementCandidate = z.infer<typeof ImprovementCandidateSchema>;
