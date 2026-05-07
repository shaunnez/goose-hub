import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

/**
 * Wave-1 scout-dependency agent: map direct + first-tier transitive imports
 * of a module relevant to the work item. Read-only.
 */
export const ScoutDependencyContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
  }),
  scoutFocus: z
    .string()
    .describe('One sentence describing the module whose dependency graph to map'),
  worktreePath: z.string(),
});

const config: SkillConfig = {
  contextSchema: ScoutDependencyContextSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'scoutFocus',
    'worktreePath',
  ],
  toolBundles: ['read'],
  modelPin: 'haiku',
  freshContext: true,
  role: 'investigator',
};

export default config;
