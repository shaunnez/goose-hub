import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { ScoutOutputSchema } from './schema.js';

/**
 * Wave-1 scout-schema agent: locate DB schema + Zod schema definitions
 * relevant to the work item. Read-only. Returns file:line citations only.
 *
 * Context (rendered as XML in the user prompt):
 *
 *   <task>
 *     <workItem>{"title":"...","body":"...","number":123}</workItem>
 *     <scoutFocus>...</scoutFocus>
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
  contextSchema: ScoutSchemaContextSchema,
  outputSchema: ScoutOutputSchema,
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
