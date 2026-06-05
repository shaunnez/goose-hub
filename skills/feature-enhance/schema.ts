import { z } from 'zod';
import { GroundedCandidateFileSchema } from '../bug-enhance/schema.js';

export const FeatureEnhanceConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const FeatureEnhanceOutputSchema = z.object({
  candidateFiles: z.array(GroundedCandidateFileSchema).max(15).default([]),
  existingSurfaces: z.array(z.string().min(1).max(500)).max(15).default([]),
  similarPatterns: z.array(z.string().min(1).max(500)).max(10).default([]),
  testSurfaces: z.array(z.string().min(1).max(500)).max(10).default([]),
  acceptanceHints: z.array(z.string().min(1).max(500)).max(10).default([]),
  openQuestions: z.array(z.string().min(1).max(500)).max(10).default([]),
  confidence: FeatureEnhanceConfidenceSchema,
  escalationSignals: z.array(z.string().min(1).max(500)).max(10).default([]),
});

export type FeatureEnhanceOutput = z.infer<typeof FeatureEnhanceOutputSchema>;
export type FeatureEnhanceConfidence = z.infer<typeof FeatureEnhanceConfidenceSchema>;
