import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { ScoutReportDigestBundleSchema } from '@goose-hub/core/scout-reports/digest.js';
import { z } from 'zod';
import { Wave2RiskAnalystSchema } from './schema.js';

/**
 * Wave-2 risk-analyst agent. Consumes the cross-validated Wave-1 scout digest
 * and emits a falsifiable risk register.
 */
export const Wave2RiskAnalystContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
  }),
  /** Cross-validated scout digest. */
  scoutDigest: ScoutReportDigestBundleSchema.optional(),
});

const config: SkillConfig = {
  contextSchema: Wave2RiskAnalystContextSchema,
  outputSchema: Wave2RiskAnalystSchema,
  contextAllowlist: ['workItem.title', 'workItem.body', 'workItem.number', 'scoutDigest'],
  toolBundles: ['read'],
  modelPin: 'sonnet',
  freshContext: true,
  role: 'investigator',
};

export default config;
