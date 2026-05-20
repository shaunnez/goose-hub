import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { DecomposeOutputSchema } from './schema.js';

export const DecomposeIssuesContextSchema = z.object({
  parentIssue: z.object({
    number: z.number().int(),
    title: z.string(),
    body: z.string(),
  }),
  prdOutput: z.unknown(),
});

const config: SkillConfig = {
  contextSchema: DecomposeIssuesContextSchema,
  outputSchema: DecomposeOutputSchema,
  toolBundles: ['core'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'decomposer',
  contextAllowlist: ['parentIssue.number', 'parentIssue.title', 'parentIssue.body', 'prdOutput'],
};

export default config;
