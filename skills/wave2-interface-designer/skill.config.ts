import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { ScoutReportDigestBundleSchema } from '@goose-hub/core/scout-reports/digest.js';
import { z } from 'zod';
import { Wave2InterfaceDesignerSchema } from './schema.js';

/**
 * Wave-2 interface-designer agent. Consumes the cross-validated Wave-1
 * scout digest (passed in via `<scoutDigest>` in the user prompt) and
 * emits paste-ready Zod schemas, function signatures, and DDL.
 *
 * Read-only — the designer does not write files; the implementer (M19.03)
 * does.
 */
export const Wave2InterfaceDesignerContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
  }),
  /** Cross-validated scout digest. */
  scoutDigest: ScoutReportDigestBundleSchema.optional(),
});

const config: SkillConfig = {
  contextSchema: Wave2InterfaceDesignerContextSchema,
  outputSchema: Wave2InterfaceDesignerSchema,
  contextAllowlist: ['workItem.title', 'workItem.body', 'workItem.number', 'scoutDigest'],
  toolBundles: ['read'],
  modelPin: 'sonnet',
  freshContext: true,
  role: 'investigator',
};

export default config;
