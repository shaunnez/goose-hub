import { z } from 'zod';

export const DecisionSummarySchema = z.object({
  step: z.string(),
  summary: z.string(),
  evidence: z.string().optional(),
});

export const TriageOutputSchema = z.object({
  type: z.enum(['feature', 'bug', 'chore', 'research']),
  priority: z.enum(['p0', 'p1', 'p2', 'p3']),
  labels: z.array(z.string()),
  reasoning: z.string(),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type TriageOutput = z.infer<typeof TriageOutputSchema>;
