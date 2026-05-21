import { DispositionSchema } from '@goose-hub/core/findings/disposition.js';
import { PrioritySchema } from '@goose-hub/core/findings/priority.js';
import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };
export { DispositionSchema };
export { PrioritySchema };

export const CriterionCheckSchema = z.object({
  criterion: z.string(),
  status: z.enum(['met', 'unmet', 'unclear']),
  notes: z.string().optional(),
});

/**
 * Review finding shape (#468, #697). Disposition is required when severity
 * is `blocker` (the Review-side fix-or-register rule). `priority` is optional
 * on input — when omitted, `defaultReviewPriority(severity)` populates it
 * post-parse so downstream consumers (quality-score, merge-decision) always
 * see a concrete P0..P3. Shared schemas live in `core/findings/`.
 */
export const ReviewFindingSchema = z
  .object({
    criterion: z.string().optional(),
    severity: z.enum(['blocker', 'major', 'minor']),
    description: z.string(),
    suggestion: z.string().optional(),
    file: z.string().optional(),
    line: z.number().int().optional(),
    /** Disposition required when severity === 'blocker' (#468) */
    disposition: DispositionSchema.optional(),
    /** Commit SHA, issue number, or rationale matching the disposition (#468) */
    dispositionRef: z.string().min(1).optional(),
    /**
     * Priority bucket consumed by quality-score (#697). When the agent
     * omits this, the default mapper below promotes severity to a
     * sensible default (blocker → P0, major → P1, minor → P2).
     */
    priority: PrioritySchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.severity === 'blocker') {
      if (val.disposition == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'blocker-severity findings must declare a disposition (fix-or-register, #468)',
          path: ['disposition'],
        });
      }
      if (val.dispositionRef == null || val.dispositionRef.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'blocker-severity findings must include dispositionRef (commit SHA, issue #, or rationale, #468)',
          path: ['dispositionRef'],
        });
      }
    }
  });

export const ReviewOutputSchema = z
  .object({
    verdict: z.enum(['approved', 'needs-fix', 'needs-human']),
    confidence: z.number().min(0).max(1),
    criteriaChecks: z.array(CriterionCheckSchema),
    findings: z.array(ReviewFindingSchema),
    decisionSummaries: z.array(DecisionSummarySchema),
    escalationReason: z.string().nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.verdict !== 'needs-human') return;
    if (typeof val.escalationReason === 'string' && val.escalationReason.trim().length > 0) {
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'needs-human verdicts must include a non-blank escalationReason',
      path: ['escalationReason'],
    });
  });

export type { Disposition } from '@goose-hub/core/findings/disposition.js';
export type { Priority } from '@goose-hub/core/findings/priority.js';
export type DecisionSummary = z.infer<typeof DecisionSummarySchema>;
export type CriterionCheck = z.infer<typeof CriterionCheckSchema>;
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;
export type ReviewVerdict = ReviewOutput['verdict'];
