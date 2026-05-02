import { z } from 'zod';

export const DecisionSummarySchema = z.object({
  step: z.string(),
  summary: z.string(),
  evidence: z.string().optional(),
});

export const KeyFileSchema = z.object({
  path: z.string(),
  reason: z.string(),
});

export const InvestigateSchema = z.object({
  findings: z.string().describe('Root cause hypothesis and analysis'),
  keyFiles: z.array(KeyFileSchema).describe('Files most relevant to the bug'),
  confidence: z.enum(['low', 'medium', 'high']),
  openQuestions: z.array(z.string()).describe('Unresolved questions requiring more investigation'),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type KeyFile = z.infer<typeof KeyFileSchema>;
export type InvestigateOutput = z.infer<typeof InvestigateSchema>;
