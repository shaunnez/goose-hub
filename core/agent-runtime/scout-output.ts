import { z } from 'zod';
import { DecisionSummarySchema } from '../retrospective/schemas.js';

/**
 * Canonical Wave-1 scout output shape (M19.01, ADR 0030).
 *
 * Every `skills/scout-*` skill imports `ScoutOutputSchema` from here and
 * re-exports it from its own `schema.ts`. Wave 1 is fact-only — `findings`
 * is a list of file:line citations, not synthesis. Synthesis happens in
 * Wave 2 (interface-designer / risk-analyst).
 */
export const ScoutFindingSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().nonnegative().optional(),
  fact: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const ScoutStatusSchema = z.enum(['ok', 'timeout', 'error']);

export const ScoutOutputSchema = z.object({
  findings: z.array(ScoutFindingSchema),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
  status: ScoutStatusSchema,
});

export type ScoutFinding = z.infer<typeof ScoutFindingSchema>;
export type ScoutStatus = z.infer<typeof ScoutStatusSchema>;
export type ScoutOutput = z.infer<typeof ScoutOutputSchema>;
