import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

export const ProjectContextSchema = z.object({
  stackSummary: z.string(),
  contextMd: z.string(),
  adrSummaries: z.array(
    z.object({
      filename: z.string(),
      title: z.string(),
      status: z.string(),
      oneLiner: z.string(),
    }),
  ),
  claudeMd: z.string(),
});

export const GrillPriorReplyEntrySchema = z.object({
  role: z.enum(['user', 'agent']),
  content: z.string(),
  crystallized: z.string().optional(),
});

export const GrillMeContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.union([z.number().int(), z.string()]),
  }),
  priorReplies: z.array(GrillPriorReplyEntrySchema),
  roundNumber: z.number().int().min(1),
  projectContext: ProjectContextSchema,
});

const config: SkillConfig = {
  contextSchema: GrillMeContextSchema,
  toolBundles: ['read'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'griller',
  contextAllowlist: ['workItem', 'priorReplies', 'roundNumber', 'projectContext'],
};

export default config;
