import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

/**
 * Wave-2 interface-designer agent. Consumes the cross-validated Wave-1
 * scout reports (passed in via `<scoutReports>` in the user prompt) and
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
  /** Cross-validated scout reports rendered as a JSON string. */
  scoutReports: z.string(),
  worktreePath: z.string(),
});

const config: SkillConfig = {
  contextSchema: Wave2InterfaceDesignerContextSchema,
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
