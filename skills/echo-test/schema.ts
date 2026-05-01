import { z } from 'zod';

export const DecisionSummarySchema = z.object({
  step: z.string(),
  summary: z.string(),
  evidence: z.string().optional(),
});

export const EchoOutputSchema = z.object({
  echo: z.string(),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type EchoOutput = z.infer<typeof EchoOutputSchema>;
