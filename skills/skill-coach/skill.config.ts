import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { SkillCoachOutputSchema } from './schema.js';

export const SkillCoachContextSchema = z.object({
  projectId: z.string().min(1),
  targetSkillName: z.string().min(1),
  skillSourceFiles: z.object({
    skillMd: z.string().describe("The target skill's prompt.md contents"),
    schemaTsExcerpt: z.string().describe("The target skill's schema.ts contents"),
  }),
  evidencePatterns: z.array(
    z.object({
      patternId: z.string(),
      pattern: z.string(),
      occurrenceCount: z.number().int(),
      consistencyScore: z.number().min(0).max(1),
      role: z.string().optional(),
      kind: z.string().optional(),
      exampleWorkItemIds: z.array(z.string()).default([]),
    }),
  ),
  evidenceLifecycles: z
    .array(
      z.object({
        workItemId: z.string(),
        closedAt: z.string(),
        decisionSummaries: z.array(z.unknown()).default([]),
        learningEntries: z.array(z.unknown()).default([]),
        qualityScores: z.array(z.unknown()).default([]),
      }),
    )
    .default([]),
});

const config: SkillConfig = {
  contextSchema: SkillCoachContextSchema,
  outputSchema: SkillCoachOutputSchema,
  contextAllowlist: [
    'projectId',
    'targetSkillName',
    'skillSourceFiles',
    'evidencePatterns',
    'evidenceLifecycles',
  ],
  toolBundles: ['core'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'retrospector',
};

export default config;
