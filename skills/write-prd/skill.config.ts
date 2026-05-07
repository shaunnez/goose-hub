import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

export const WritePRDContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number().int(),
  }),
  refinedIntent: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
});

const config: SkillConfig = {
  contextSchema: WritePRDContextSchema,
  toolBundles: ['read', 'core'],
  modelPin: 'opus',
  freshContext: true,
  role: 'prd-writer',
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'refinedIntent',
    'priority',
  ],
};

export default config;
