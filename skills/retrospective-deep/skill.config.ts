import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';
import { DeepRetroSchema } from './schema.js';

export const DeepRetroContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
  }),
  runSummary: z.object({
    personaId: z.string(),
    role: z.string(),
    outcome: z.enum(['success', 'failure', 'partial']),
    decisionSummaries: z.array(DecisionSummarySchema),
    retryCount: z.number().int().min(0).optional(),
    qaFailed: z.boolean().optional(),
  }),
  triggerReasons: z.array(z.string()).describe('Why deep tier was selected'),
  activePersonas: z.array(z.string()).optional(),
  roleTrends: z
    .array(
      z.object({
        role: z.string(),
        sampleCount: z.number().int().min(0),
        delta: z.number(),
        trend: z.enum(['improving', 'stable', 'declining']),
      }),
    )
    .optional(),
});

const config: SkillConfig = {
  contextSchema: DeepRetroContextSchema,
  outputSchema: DeepRetroSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'runSummary.personaId',
    'runSummary.role',
    'runSummary.outcome',
    'runSummary.decisionSummaries',
    'runSummary.retryCount',
    'runSummary.qaFailed',
    'triggerReasons',
    'activePersonas',
    'roleTrends',
  ],
  toolBundles: ['core'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'retrospector',
};

export default config;
