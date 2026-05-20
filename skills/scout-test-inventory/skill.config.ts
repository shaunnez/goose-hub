import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

/**
 * Wave-1 scout-test-inventory agent: catalog existing tests covering the
 * work-item area. Read-only.
 */
export const ScoutTestInventoryContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
  }),
  scoutFocus: z.string().describe('One sentence describing the test surface to inventory'),
  symbolIndexHints: z
    .array(
      z.object({
        name: z.string(),
        definedIn: z.string(),
        line: z.number(),
        kind: z.string(),
        callers: z.array(z.string()),
        importers: z.array(z.string()).optional(),
        nearbyTests: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

const config: SkillConfig = {
  contextSchema: ScoutTestInventoryContextSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'scoutFocus',
    'symbolIndexHints',
  ],
  toolBundles: ['read'],
  modelPin: 'haiku',
  freshContext: true,
  role: 'investigator',
};

export default config;
