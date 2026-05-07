import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

/**
 * Output schema for the PRD advisor skill.
 *
 * Invariants (enforced via superRefine):
 * - When `verdict === 'approve'`: `revisedSections` MUST be empty.
 * - When `verdict === 'revise'`: `revisedSections` MAY contain only the changed section keys.
 * - `concerns` may be empty or non-empty in either verdict.
 *   An `approve` with non-empty `concerns` is valid (approved with notes).
 */
export const AdvisePRDOutputSchema = z
  .object({
    verdict: z.enum(['approve', 'revise']),
    concerns: z.array(z.string()).max(5),
    revisedSections: z.record(z.string(), z.string()),
    decisionSummaries: z.array(DecisionSummarySchema).min(1),
  })
  .superRefine((data, ctx) => {
    if (data.verdict === 'approve' && Object.keys(data.revisedSections).length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'revisedSections must be empty when verdict is "approve" — an approval cannot carry section rewrites',
        path: ['revisedSections'],
      });
    }
  });

export type AdvisePRDOutput = z.infer<typeof AdvisePRDOutputSchema>;
