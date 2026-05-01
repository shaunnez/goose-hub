import { z } from 'zod';
import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';

export const EchoContextSchema = z.object({
  message: z.string(),
});

const config: SkillConfig = {
  contextSchema: EchoContextSchema,
  toolBundles: [],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'developer',
};

export default config;
