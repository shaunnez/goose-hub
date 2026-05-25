import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { FeatureFrameOutputSchema } from './schema.js';

export const FeatureFrameContextSchema = z
  .object({
    workItem: z
      .object({
        title: z.string(),
        body: z.string(),
        number: z.union([z.number().int(), z.string()]).optional(),
      })
      .strict(),
  })
  .strict();

const config: SkillConfig = {
  contextSchema: FeatureFrameContextSchema,
  outputSchema: FeatureFrameOutputSchema,
  contextAllowlist: ['workItem'],
  toolBundles: ['read'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'triager',
};

export default config;
