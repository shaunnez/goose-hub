import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { IdeaPromotionEnhanceOutputSchema } from './schema.js';

const SupportedPromotionTypeSchema = z.enum(['feature', 'chore', 'research']);

export const IdeaPromotionEnhanceContextSchema = z.object({
  workItem: z.object({
    type: SupportedPromotionTypeSchema,
    title: z.string(),
    body: z.string(),
  }),
});

const config: SkillConfig = {
  contextSchema: IdeaPromotionEnhanceContextSchema,
  outputSchema: IdeaPromotionEnhanceOutputSchema,
  contextAllowlist: ['workItem'],
  toolBundles: [],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'triager',
};

export default config;
