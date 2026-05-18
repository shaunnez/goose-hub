import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

/**
 * Wave-1 scout-code-path agent: trace the execution path of a function or
 * symbol mentioned in the work item. Read-only. Returns file:line citations.
 */
export const ScoutCodePathContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
  }),
  scoutFocus: z
    .string()
    .describe('One sentence describing the symbol or function whose call path to trace'),
  worktreePath: z.string(),
  symbolIndexHints: z
    .array(
      z.object({
        name: z.string(),
        definedIn: z.string(),
        line: z.number(),
        kind: z.string(),
        callers: z.array(z.string()),
      }),
    )
    .optional(),
});

const config: SkillConfig = {
  contextSchema: ScoutCodePathContextSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'scoutFocus',
    'worktreePath',
    'symbolIndexHints',
  ],
  toolBundles: ['read'],
  modelPin: 'haiku',
  freshContext: true,
  role: 'investigator',
};

export default config;
