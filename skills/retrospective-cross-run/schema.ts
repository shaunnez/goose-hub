import {
  DecisionPatternSchema,
  ImprovementCandidateSchema,
  LearningEntrySchema,
  RetroOutputBaseSchema,
} from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { ImprovementCandidateSchema };

export const GateThresholdSchema = z.object({
  gate: z.enum(['qa', 'review']),
  meanScore: z.number().min(0).max(1),
  minScore: z.number().min(0).max(1),
  maxScore: z.number().min(0).max(1),
  stdDev: z.number().min(0).optional(),
  sampleCount: z.number().int().min(0),
});

export const CostBaselineSchema = z.object({
  role: z.string(),
  skill: z.string(),
  meanCost: z.number().min(0),
  p50Cost: z.number().min(0),
  p95Cost: z.number().min(0),
  sampleCount: z.number().int().min(0),
});

export const AggregatedLearningSchema = z.object({
  observation: z.string().min(1),
  occurrenceCount: z.number().int().min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  firstSeen: z.string().datetime(),
  lastSeen: z.string().datetime(),
});

export const TopPatternSchema = DecisionPatternSchema.extend({
  consistencyScore: z.number().min(0).max(1),
  occurrenceCount: z.number().int().min(1),
});

export const CrossRunRetroSchema = RetroOutputBaseSchema.extend({
  windowStartAt: z.string().datetime(),
  windowEndAt: z.string().datetime(),
  lifecycleCount: z.number().int().min(0),
  aggregatedLearnings: z.array(AggregatedLearningSchema),
  topPatterns: z.array(TopPatternSchema),
  gateThresholds: z.array(GateThresholdSchema),
  costBaselines: z.array(CostBaselineSchema),
});

export type CrossRunRetroOutput = z.infer<typeof CrossRunRetroSchema>;
export type GateThreshold = z.infer<typeof GateThresholdSchema>;
export type CostBaseline = z.infer<typeof CostBaselineSchema>;
export type AggregatedLearning = z.infer<typeof AggregatedLearningSchema>;
export type TopPattern = z.infer<typeof TopPatternSchema>;
export type ImprovementCandidate = z.infer<typeof ImprovementCandidateSchema>;
