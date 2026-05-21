import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { IssueEnhanceOutputSchema } from './schema.js';

export const IssueEnhanceContextSchema = z.object({
  workItem: z.object({
    type: z.enum(['feature', 'chore', 'research']),
    title: z.string(),
    body: z.string(),
  }),
});

const config: SkillConfig = {
  contextSchema: IssueEnhanceContextSchema,
  outputSchema: IssueEnhanceOutputSchema,
  contextAllowlist: ['workItem'],
  toolBundles: [],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'triager',
};

export default config;
