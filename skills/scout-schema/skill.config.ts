import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

/**
 * Wave-1 scout-schema agent: locate DB schema + Zod schema definitions
 * relevant to the work item. Read-only. Returns file:line citations only.
 *
 * Context (rendered as XML in the user prompt):
 *
 *   <task>
 *     <workItem>{"title":"...","body":"...","number":123}</workItem>
 *     <scoutFocus>...</scoutFocus>
 *     <worktreePath>...</worktreePath>
 *   </task>
 */
export const ScoutSchemaContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
  }),
  scoutFocus: z
    .string()
    .describe('One sentence describing the schema concern this scout investigates'),
  worktreePath: z.string(),
});

const config: SkillConfig = {
  contextSchema: ScoutSchemaContextSchema,
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
