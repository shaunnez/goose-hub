import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

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
});

const config: SkillConfig = {
  contextSchema: LightRetroContextSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'runSummary.personaId',
    'runSummary.role',
    'runSummary.outcome',
    'runSummary.decisionSummaries',
    'activePersonas',
  ],
  toolBundles: ['core'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'retrospector',
};

export default config;
