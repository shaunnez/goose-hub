import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

/**
 * Wave-2 risk-analyst output (M19.01, ADR 0030).
 *
 * Reads cross-validated Wave-1 scout reports and produces a structured risk
 * register: each entry names a concrete failure mode, cites the scout
 * finding(s) supporting it, and proposes a falsifiable mitigation.
 */
export const RiskEntrySchema = z.object({
  risk: z.string().min(1),
  /** One sentence. Must reference scout findings (file:line). */
  evidence: z.string().min(1),
  mitigation: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']),
});

export const Wave2RiskAnalystSchema = z.object({
  risks: z.array(RiskEntrySchema),
  /** Open questions the analyst could not resolve from Wave-1 reports alone. */
  openQuestions: z.array(z.string()),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type RiskEntry = z.infer<typeof RiskEntrySchema>;
export type Wave2RiskAnalystOutput = z.infer<typeof Wave2RiskAnalystSchema>;
