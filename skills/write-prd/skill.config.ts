import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { ProjectContextSchema } from '../grill-me/skill.config.js';
import { PRDOutputSchema } from './schema.js';

export { ProjectContextSchema };

export const WritePRDContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number().int(),
  }),
  refinedIntent: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  projectContext: ProjectContextSchema,
  priorPrd: PRDOutputSchema.optional(),
  humanConcerns: z.array(z.string()).optional(),
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
    'projectContext',
    'priorPrd',
    'humanConcerns',
  ],
};

export default config;
