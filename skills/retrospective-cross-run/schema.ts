import {
  ImprovementCandidateSchema as BaseImprovementCandidateSchema,
  LearningEntrySchema,
  RetroOutputBaseSchema,
} from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export const GateNameSchema = z.enum(['qa', 'review']);

export const GateThresholdSchema = z.object({
  gate: GateNameSchema,
  mean: z.number(),
  min: z.number(),
  max: z.number(),
  stdDev: z.number().min(0),
  sampleCount: z.number().int().min(0),
});

export const CostBaselineSchema = z.object({
  role: z.string().min(1),
  skill: z.string().min(1),
  mean: z.number().min(0),
  p50: z.number().min(0),
  p95: z.number().min(0),
  sampleCount: z.number().int().min(0),
});

export const CrossRunPatternSchema = z.object({
  patternId: z.string().min(1),
  pattern: z.string().min(1),
  occurrenceCount: z.number().int().min(1),
  consistencyScore: z.number().min(0).max(1),
  role: z.string().optional(),
  kind: z.string().optional(),
  exampleWorkItemIds: z.array(z.string()).default([]),
});

const PATTERN_BACKED_KINDS = new Set(['skill-prompt', 'skill-schema', 'skill-config']);

const ImprovementCandidateRequiringEvidence = BaseImprovementCandidateSchema.superRefine(
  (candidate, ctx) => {
    if (!PATTERN_BACKED_KINDS.has(candidate.kind)) return;
    const evidence = candidate.evidence ?? '';
    if (!/(^|[^a-zA-Z])pattern[:#-]?[\w-]+/i.test(evidence)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidence'],
        message:
          'evidence must cite at least one pattern id (e.g. "pattern:foo-bar") when kind is skill-prompt, skill-schema, or skill-config',
      });
    }
  },
);

export const CrossRunRetroOutputSchema = RetroOutputBaseSchema.extend({
  windowStartAt: z.string().min(1),
  windowEndAt: z.string().min(1),
  lifecycleCount: z.number().int().min(0),
  aggregatedLearnings: z.array(LearningEntrySchema),
  topPatterns: z.array(CrossRunPatternSchema),
  gateThresholds: z.array(GateThresholdSchema),
  costBaselines: z.array(CostBaselineSchema),
  improvementCandidates: z.array(ImprovementCandidateRequiringEvidence),
});

export type CrossRunRetroOutput = z.infer<typeof CrossRunRetroOutputSchema>;
export type GateThreshold = z.infer<typeof GateThresholdSchema>;
export type CostBaseline = z.infer<typeof CostBaselineSchema>;
export type CrossRunPattern = z.infer<typeof CrossRunPatternSchema>;
export { LearningEntrySchema };
export type AggregatedLearning = z.infer<typeof LearningEntrySchema>;
