import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { ScoutReportDigestBundleSchema } from '@goose-hub/core/scout-reports/digest.js';
import { z } from 'zod';
import { ResearchSchema } from './schema.js';

export const ResearchContextSchema = z
  .object({
    workItem: z.object({
      title: z.string(),
      body: z.string(),
      number: z.number(),
    }),
    scoutDigest: ScoutReportDigestBundleSchema.optional(),
  })
  .strict();

const config: SkillConfig = {
  contextSchema: ResearchContextSchema,
  outputSchema: ResearchSchema,
  contextAllowlist: ['workItem', 'scoutDigest'],
  toolBundles: ['read'],
  freshContext: false,
  role: 'researcher',
};

export default config;
