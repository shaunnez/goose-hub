import { z } from 'zod';

export const DecisionSummarySchema = z.object({
  step: z.string(),
  summary: z.string(),
  evidence: z.string().optional(),
});

const ConfidenceSchema = z.enum(['low', 'medium', 'high']);

/**
 * Advisor verdict — canonical typed union per CONTEXT.md "Advisor Flow".
 *
 * - `proceed`: plan is sound; primary continues.
 * - `revise`: plan has a fixable issue; primary re-spawned with `feedback`.
 * - `abort`:  plan is unsafe / out of scope; immediate escalation. NOT revisable.
 *
 * Pass discipline: at most one revise pass before escalation
 * (FACTORY_RULES rule 21, CONTEXT.md state-machine table).
 */
export const AdvisorVerdictSchema = z.discriminatedUnion('verdict', [
  z.object({
    verdict: z.literal('proceed'),
    confidence: ConfidenceSchema,
  }),
  z.object({
    verdict: z.literal('revise'),
    feedback: z.string().min(1).describe('Concrete feedback the primary must address on retry'),
    confidence: ConfidenceSchema,
  }),
  z.object({
    verdict: z.literal('abort'),
    reason: z.string().min(1).describe('Why this plan is unsafe; surfaced to human reviewer'),
    confidence: ConfidenceSchema,
  }),
]);

export const AdviseOnPlanSchema = z.intersection(
  AdvisorVerdictSchema,
  z.object({
    decisionSummaries: z.array(DecisionSummarySchema).min(1),
  }),
);

export type AdvisorVerdict = z.infer<typeof AdvisorVerdictSchema>;
export type AdviseOnPlanOutput = z.infer<typeof AdviseOnPlanSchema>;
