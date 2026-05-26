import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import {
  InvestigationSeedSchema,
  SeedEvidenceSchema,
} from '@goose-hub/core/agent-runtime/scout-prefetch.js';
import { z } from 'zod';
import { ScoutOutputSchema } from './schema.js';

/**
 * Wave-1 scout-user-journey agent: walk the user-facing flow (UI route or
 * API surface) implicated by the work item. Read-only.
 */
export const ScoutUserJourneyContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
  }),
  scoutFocus: z.string().describe('One sentence describing the user-facing flow to walk'),
  investigationSeed: InvestigationSeedSchema.optional(),
  seedEvidence: SeedEvidenceSchema.optional(),
});

const config: SkillConfig = {
  contextSchema: ScoutUserJourneyContextSchema,
  outputSchema: ScoutOutputSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'scoutFocus',
    'investigationSeed',
    'seedEvidence',
  ],
  toolBundles: ['read'],
  modelPin: 'haiku',
  freshContext: true,
  role: 'investigator',
};

export default config;
