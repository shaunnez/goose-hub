import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';
import { LightRetroSchema } from './schema.js';

export const LightRetroContextSchema = z.object({
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
  }),
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
  contextSchema: LightRetroContextSchema,
  outputSchema: LightRetroSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'runSummary.personaId',
    'runSummary.role',
    'runSummary.outcome',
    'runSummary.decisionSummaries',
    'activePersonas',
    'roleTrends',
  ],
  toolBundles: ['core'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'retrospector',
};

export default config;
