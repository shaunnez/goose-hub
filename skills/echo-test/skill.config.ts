import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { EchoOutputSchema } from './schema.js';

export const EchoContextSchema = z.object({
  message: z.string(),
});

const config: SkillConfig = {
  contextSchema: EchoContextSchema,
  outputSchema: EchoOutputSchema,
  contextAllowlist: ['message'],
  toolBundles: [],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'developer',
};

export default config;
