import { z } from 'zod';

export const DecisionSummarySchema = z.object({
  step: z.string(),
  summary: z.string(),
  evidence: z.string().optional(),
});

export const BugEnhanceOutputSchema = z.object({
  enhancedContent: z
    .string()
    .describe('Structured markdown sections to append after the original bug body'),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type BugEnhanceOutput = z.infer<typeof BugEnhanceOutputSchema>;
