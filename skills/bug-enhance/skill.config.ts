import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

export const BugEnhanceContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
  }),
});

const config: SkillConfig = {
  contextSchema: BugEnhanceContextSchema,
  toolBundles: [],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'triager',
};

export default config;
