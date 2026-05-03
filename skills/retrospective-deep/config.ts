import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

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
    decisionSummaries: z.array(z.object({ step: z.string(), summary: z.string() })),
    retryCount: z.number().int().min(0),
    qaFailed: z.boolean(),
  }),
  triggerReasons: z.array(z.string()).describe('Why deep tier was selected'),
});

const config: SkillConfig = {
  contextSchema: DeepRetroContextSchema,
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
  ],
  toolBundles: ['core'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'retrospector',
};

export default config;
