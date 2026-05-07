import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

export const SprintReviewContextSchema = z.object({
  milestone: z.object({
    title: z.string(),
    number: z.number(),
  }),
  closedIssues: z.array(
    z.object({
      number: z.number(),
      title: z.string(),
      labels: z.array(z.string()),
    }),
  ),
  retroOutputs: z.array(
    z.object({
      workItemNumber: z.number(),
      summary: z.object({
        wentWell: z.string(),
        didNotGoWell: z.string(),
        architecturalTakeaway: z.string(),
      }),
      learningEntries: z.array(z.unknown()).optional(),
    }),
  ),
  improvementCandidates: z.array(
    z.object({
      kind: z.string(),
      suggestionText: z.string(),
      confidence: z.string(),
    }),
  ),
});

const config: SkillConfig = {
  contextSchema: SprintReviewContextSchema,
  contextAllowlist: [
    'milestone.title',
    'milestone.number',
    'closedIssues',
    'retroOutputs',
    'improvementCandidates',
  ],
  toolBundles: ['core'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'retrospector',
};

export default config;
