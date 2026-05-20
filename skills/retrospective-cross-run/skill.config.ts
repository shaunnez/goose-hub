import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import {
  CostBaselineSchema,
  CrossRunPatternSchema,
  CrossRunRetroOutputSchema,
  GateThresholdSchema,
  LearningEntrySchema,
} from './schema.js';

export const CrossRunRetroContextSchema = z.object({
  projectId: z.string().min(1),
  windowStartAt: z.string().min(1),
  windowEndAt: z.string().min(1),
  lifecycleCount: z.number().int().min(0),
  archivedLifecycles: z
    .array(
      z.object({
        workItemId: z.string(),
        closedAt: z.string(),
        decisionSummaries: z.array(z.unknown()).default([]),
        learningEntries: z.array(z.unknown()).default([]),
        qualityScores: z.array(z.unknown()).default([]),
        costsUsd: z.number().default(0),
      }),
    )
    .describe('All archived lifecycles in the requested window'),
  minedPatterns: z
    .array(CrossRunPatternSchema)
    .describe('Pre-mined decision patterns from core/learning/mine.ts'),
  precomputedGateThresholds: z
    .array(GateThresholdSchema)
    .describe('Numerically-computed gate thresholds (mean/min/max/stdDev) for qa and review'),
  precomputedCostBaselines: z
    .array(CostBaselineSchema)
    .describe('Numerically-computed cost baselines (mean/p50/p95) per (role, skill)'),
  priorAggregatedLearnings: z.array(LearningEntrySchema).default([]),
});

const config: SkillConfig = {
  contextSchema: CrossRunRetroContextSchema,
  outputSchema: CrossRunRetroOutputSchema,
  contextAllowlist: [
    'projectId',
    'windowStartAt',
    'windowEndAt',
    'lifecycleCount',
    'archivedLifecycles',
    'minedPatterns',
    'precomputedGateThresholds',
    'precomputedCostBaselines',
    'priorAggregatedLearnings',
  ],
  toolBundles: ['core'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'retrospector',
};

export default config;
