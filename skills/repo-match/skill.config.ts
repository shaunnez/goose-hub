import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

export const RepoMatchContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
  }),
});

const config: SkillConfig = {
  contextSchema: RepoMatchContextSchema,
  toolBundles: [],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'researcher',
};

export default config;
