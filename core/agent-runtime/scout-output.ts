import { z } from 'zod';
import { DecisionKindSchema } from './decision-types.js';

/**
 * Canonical Wave-1 scout output shape (M19.01, ADR 0030).
 *
 * Every `skills/scout-*` skill imports `ScoutOutputSchema` from here and
 * re-exports it from its own `schema.ts`. Wave 1 is fact-only — `findings`
 * is a list of file:line citations, not synthesis. Synthesis happens in
 * Wave 2 (interface-designer / risk-analyst).
 *
 * `ScoutDecisionSummarySchema` uses `.catch('UNKNOWN')` on kind so that a
 * model hallucinating an out-of-vocabulary kind does not fail validation and
 * halt the wave. Prompt enumeration is the primary fix; this is defense-in-depth.
 */
export const ScoutFindingSchema = z.object({
  file: z.string().min(1),
  line: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.number().int().nonnegative().optional(),
  ),
  fact: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
});

const ScoutDecisionSummarySchema = z.object({
  kind: DecisionKindSchema.catch('UNKNOWN'),
  summary: z.string(),
  evidence: z.string().optional(),
});

export const ScoutStatusSchema = z.enum(['ok', 'timeout', 'error']);

export const ScoutOutputSchema = z.object({
  findings: z.array(ScoutFindingSchema),
  decisionSummaries: z.array(ScoutDecisionSummarySchema).min(1),
  status: ScoutStatusSchema,
});

export type ScoutFinding = z.infer<typeof ScoutFindingSchema>;
export type ScoutStatus = z.infer<typeof ScoutStatusSchema>;
export type ScoutOutput = z.infer<typeof ScoutOutputSchema>;
