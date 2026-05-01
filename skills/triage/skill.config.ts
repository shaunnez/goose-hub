import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

export const TriageContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
  }),
});

const config: SkillConfig = {
  contextSchema: TriageContextSchema,
  toolBundles: [],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'triager',
};

export default config;
