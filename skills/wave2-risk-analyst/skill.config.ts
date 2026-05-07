import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

/**
 * Wave-2 risk-analyst agent. Consumes cross-validated Wave-1 scout reports
 * and emits a falsifiable risk register.
 */
export const Wave2RiskAnalystContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
  }),
  /** Cross-validated scout reports rendered as a JSON string. */
  scoutReports: z.string(),
  worktreePath: z.string(),
});

const config: SkillConfig = {
  contextSchema: Wave2RiskAnalystContextSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'scoutReports',
    'worktreePath',
  ],
  toolBundles: ['read'],
  modelPin: 'sonnet',
  freshContext: true,
  role: 'investigator',
};

export default config;
