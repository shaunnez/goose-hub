import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

export const CrossRunRetroContextSchema = z.object({
  projectId: z.string(),
  windowStartAt: z.string().datetime(),
  windowEndAt: z.string().datetime(),
  lifecycleCount: z.number().int().min(0),
  sampleRetroOutputs: z.array(
    z.object({
      workItemNumber: z.number(),
      aggregatedLearnings: z.array(z.object({ observation: z.string() })),
      topPatterns: z.array(z.object({ pattern: z.string(), occurrences: z.number() })),
    }),
  ),
  historicalGateScores: z.array(
    z.object({
      gate: z.enum(['qa', 'review']),
      scores: z.array(z.number().min(0).max(1)),
    }),
  ),
  historicalCosts: z.array(
    z.object({
      role: z.string(),
      skill: z.string(),
      costs: z.array(z.number().min(0)),
    }),
  ),
});

const config: SkillConfig = {
  contextSchema: CrossRunRetroContextSchema,
  contextAllowlist: [
    'projectId',
    'windowStartAt',
    'windowEndAt',
    'lifecycleCount',
    'sampleRetroOutputs',
    'historicalGateScores',
    'historicalCosts',
  ],
  toolBundles: ['core'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'retrospector',
};

export default config;
