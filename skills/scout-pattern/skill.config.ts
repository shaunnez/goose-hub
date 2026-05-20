import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { ScoutOutputSchema } from './schema.js';

/**
 * Wave-1 scout-pattern agent: locate uses of a code idiom or pattern that
 * the work item area should follow (or is failing to follow). Read-only.
 */
export const ScoutPatternContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
  }),
  scoutFocus: z.string().describe('One sentence describing the pattern or idiom to find usages of'),
});

const config: SkillConfig = {
  contextSchema: ScoutPatternContextSchema,
  outputSchema: ScoutOutputSchema,
  contextAllowlist: ['workItem.title', 'workItem.body', 'workItem.number', 'scoutFocus'],
  toolBundles: ['read'],
  modelPin: 'haiku',
  freshContext: true,
  role: 'investigator',
};

export default config;
