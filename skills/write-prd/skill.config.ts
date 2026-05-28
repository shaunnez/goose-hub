import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { GrillPriorReplyEntrySchema, ProjectContextSchema } from '../grill-me/skill.config.js';
import { PRDOutputSchema } from './schema.js';

export { ProjectContextSchema };

export const CodeGroundingContextSchema = z.object({
  groundingRunId: z.string(),
  existingSurfaces: z.array(z.string()).optional(),
  confirmedExports: z
    .array(
      z.object({
        path: z.string(),
        symbol: z.string(),
        evidence: z.string().optional(),
      }),
    )
    .optional(),
  plannedFiles: z.array(z.string()).optional(),
  testSurfaces: z.array(z.string()).optional(),
  reusablePatterns: z.array(z.string()).optional(),
  openQuestions: z.array(z.string()).optional(),
  scoutDigest: z.unknown().optional(),
});

export const WritePRDContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number().int(),
  }),
  refinedIntent: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  projectContext: ProjectContextSchema,
  priorReplies: z.array(GrillPriorReplyEntrySchema).optional(),
  priorPrd: PRDOutputSchema.optional(),
  humanConcerns: z.array(z.string()).optional(),
  codeGrounding: CodeGroundingContextSchema.optional(),
  scoutDigest: z.unknown().optional(),
});

const config: SkillConfig = {
  contextSchema: WritePRDContextSchema,
  outputSchema: PRDOutputSchema,
  toolBundles: ['read', 'core'],
  modelPin: 'opus',
  freshContext: true,
  role: 'prd-writer',
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'refinedIntent',
    'priority',
    'projectContext',
    'priorReplies',
    'priorPrd',
    'humanConcerns',
    'codeGrounding',
    'scoutDigest',
  ],
};

export default config;
