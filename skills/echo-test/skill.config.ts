import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

export const EchoContextSchema = z.object({
  message: z.string(),
});

const config: SkillConfig = {
  contextSchema: EchoContextSchema,
  contextAllowlist: ['message'],
  toolBundles: [],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'developer',
};

export default config;
