import { AcceptanceCriterionContractSchema } from '@goose-hub/core/acceptance-contracts/types.js';
import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { AcceptanceContractOutputSchema } from './schema.js';

export const AcceptanceContractContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
    type: z.enum(['bug', 'feature', 'chore', 'research']),
    priority: z.enum(['low', 'medium', 'high', 'critical']),
  }),
  investigation: z.object({
    findings: z.string().optional(),
    keyFiles: z.array(z.object({ path: z.string(), reason: z.string().optional() })).optional(),
    openQuestions: z.array(z.string()).optional(),
    confidence: z.enum(['low', 'medium', 'high']).optional(),
  }),
  existingCriteria: z.array(AcceptanceCriterionContractSchema).optional(),
});

const config: SkillConfig = {
  contextSchema: AcceptanceContractContextSchema,
  outputSchema: AcceptanceContractOutputSchema,
  contextAllowlist: ['workItem', 'investigation', 'existingCriteria'],
  toolBundles: ['read'],
  modelPin: 'haiku',
  freshContext: true,
  role: 'developer',
};

export default config;
