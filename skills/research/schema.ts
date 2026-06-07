import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

const ConfidenceSchema = z.enum(['low', 'medium', 'high']);

export const ResearchEvidenceSchema = z.object({
  file: z.string(),
  line: z.number().int().min(1).optional(),
  claim: z.string(),
  confidence: ConfidenceSchema,
});

export const ResearchOptionSchema = z.object({
  title: z.string(),
  tradeoffs: z.array(z.string()),
  files: z.array(z.string()).optional(),
  confidence: ConfidenceSchema,
});

export const ResearchFollowUpWorkSchema = z.object({
  type: z.enum(['feature', 'bug', 'chore', 'research']),
  title: z.string(),
  rationale: z.string(),
  actionable: z.boolean(),
});

export const ResearchSchema = z
  .object({
    summary: z.string(),
    answer: z.string(),
    evidence: z.array(ResearchEvidenceSchema),
    options: z.array(ResearchOptionSchema),
    followUpWork: z.array(ResearchFollowUpWorkSchema),
    actionability: z.enum(['directly-actionable', 'advisory', 'ambiguous', 'blocked']),
    openQuestions: z.array(z.string()),
    decisionSummaries: z.array(DecisionSummarySchema).min(1),
  })
  .strict();

export type ResearchEvidence = z.infer<typeof ResearchEvidenceSchema>;
export type ResearchOption = z.infer<typeof ResearchOptionSchema>;
export type ResearchFollowUpWork = z.infer<typeof ResearchFollowUpWorkSchema>;
export type ResearchOutput = z.infer<typeof ResearchSchema>;
