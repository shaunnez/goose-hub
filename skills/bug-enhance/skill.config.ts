import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { BugEnhanceOutputSchema } from './schema.js';

const SupportedPromotionTypeSchema = z.enum(['bug', 'feature', 'chore', 'research']);

export const BugEnhanceContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    type: SupportedPromotionTypeSchema,
  }),
});

const config: SkillConfig = {
  contextSchema: BugEnhanceContextSchema,
  outputSchema: BugEnhanceOutputSchema,
  contextAllowlist: ['workItem'],
  toolBundles: [],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'triager',
};

export default config;
