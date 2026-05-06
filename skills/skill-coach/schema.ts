import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export const SkillCoachInputSchema = z.object({
  targetSkillName: z
    .string()
    .describe('Name of the skill to coach (e.g. "investigate", "resolve-conflict")'),
  patternIds: z.array(z.string()).describe('Evidence pattern IDs from prior lifecycles'),
  lifecycleIds: z.array(z.string()).optional().describe('Optional specific lifecycle IDs'),
});

export const SkillCoachOutputSchema = z.object({
  skillName: z.string().describe('Name of the skill being coached'),
  diagnosis: z.string().describe('Human-readable analysis of convergent patterns'),
  proposedPatch: z
    .string()
    .describe('Unified diff against the skill.md, showing proposed improvements'),
  rationale: z.string().describe('One-sentence explanation of why this patch improves the skill'),
  evidencePatternIds: z.array(z.string()).describe('Pattern IDs that informed this proposal'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Confidence in the proposed patch'),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type SkillCoachInput = z.infer<typeof SkillCoachInputSchema>;
export type SkillCoachOutput = z.infer<typeof SkillCoachOutputSchema>;
