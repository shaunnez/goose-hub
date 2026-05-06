import {
  DecisionPatternSchema,
  ImprovementCandidateSchema,
  LearningEntrySchema,
  QualityScoreSchema,
  RetroOutputBaseSchema,
} from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { ImprovementCandidateSchema };

export const DeepRetroSchema = RetroOutputBaseSchema.extend({
  triggerReasons: z.array(z.string()),
  personaQualityScores: z.array(QualityScoreSchema),
  learningEntries: z.array(LearningEntrySchema),
  decisionPatterns: z.array(DecisionPatternSchema),
});

export type DeepRetroOutput = z.infer<typeof DeepRetroSchema>;
export type ImprovementCandidate = z.infer<typeof ImprovementCandidateSchema>;
