import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

export const GrillMeContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number().int(),
  }),
  priorReplies: z.array(
    z.object({
      role: z.enum(['user', 'agent']),
      content: z.string(),
    }),
  ),
  roundNumber: z.number().int().min(1),
});

const config: SkillConfig = {
  contextSchema: GrillMeContextSchema,
  toolBundles: ['core'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'griller',
  contextAllowlist: ['workItem', 'priorReplies', 'roundNumber'],
};

export default config;
