import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

export const EchoHoldoutContextSchema = z.object({
  message: z.string(),
  secret: z.string(), // intentionally excluded from contextAllowlist
});

const config: SkillConfig = {
  contextSchema: EchoHoldoutContextSchema,
  toolBundles: [],
  modelPin: 'sonnet',
  freshContext: true,
  role: 'qa',
  contextAllowlist: ['message'], // 'secret' is excluded
};

export default config;
