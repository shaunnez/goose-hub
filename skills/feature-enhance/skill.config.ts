import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { FeatureEnhanceOutputSchema } from './schema.js';

export const FeatureEnhanceContextSchema = z
  .object({
    workItem: z
      .object({
        title: z.string(),
        body: z.string(),
        number: z.union([z.number().int(), z.string()]).optional(),
      })
      .strict(),
    framedFeature: z
      .object({
        framedBody: z.string().optional(),
        refinedIntent: z.string().optional(),
      })
      .strict()
      .optional(),
    projectContext: z
      .object({
        projectId: z.string(),
        targetRepo: z.string().optional(),
        defaultBranch: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const config: SkillConfig = {
  contextSchema: FeatureEnhanceContextSchema,
  outputSchema: FeatureEnhanceOutputSchema,
  contextAllowlist: ['workItem', 'framedFeature', 'projectContext'],
  toolBundles: ['read'],
  modelPin: 'haiku',
  freshContext: false,
  role: 'triager',
};

export default config;
