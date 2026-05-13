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
  line: z.number().int().nonnegative().nullable().optional(),
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

export type ScoutFindingWire = z.infer<typeof ScoutFindingSchema>;
export type ScoutFinding = Omit<ScoutFindingWire, 'line'> & { line?: number };
export type ScoutStatus = z.infer<typeof ScoutStatusSchema>;
export type ScoutOutputWire = z.infer<typeof ScoutOutputSchema>;
export type ScoutOutput = Omit<ScoutOutputWire, 'findings'> & { findings: ScoutFinding[] };

export function normalizeScoutOutput(output: ScoutOutputWire): ScoutOutput {
  return {
    ...output,
    findings: output.findings.map(({ line, ...finding }) =>
      line == null ? finding : { ...finding, line },
    ),
  };
}
