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

export const GrillMeContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number().int(),
  }),
  priorReplies: z.array(
    z.object({
      role: z.enum(['user', 'agent']),
      content: z.string(),
    }),
  ),
  roundNumber: z.number().int().min(1),
  projectContext: ProjectContextSchema,
});

const config: SkillConfig = {
  contextSchema: GrillMeContextSchema,
  toolBundles: ['core'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'griller',
  contextAllowlist: ['workItem', 'priorReplies', 'roundNumber', 'projectContext'],
};

export default config;
