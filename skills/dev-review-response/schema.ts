import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { DevReviewFindingSchema } from '@goose-hub/skills/dev-review/schema.js';
import { z } from 'zod';

export { DecisionSummarySchema };
export { DevReviewFindingSchema };

/**
 * Per-finding developer disposition, produced by the dev-review-response
 * skill. `findingRef` is `"${file}:${line}"` for human traceability.
 *
 * - `addressed` — the developer made code changes; `commitSha` records
 *   where (set by the orchestrator after committing the worktree).
 * - `dismissed` — the developer explicitly decided not to act; `reason`
 *   is required so retro can learn from it.
 */
export const FindingDispositionSchema = z.object({
  findingRef: z.string().min(1).describe('file:line identifier from the original finding'),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']),
  disposition: z.enum(['addressed', 'dismissed']),
  commitSha: z.string().optional().describe('SHA of the fixing commit (addressed only)'),
  reason: z.string().optional().describe('Dismissal reason (dismissed only)'),
});

export const DevReviewResponseOutputSchema = z.object({
  findingDispositions: z
    .array(FindingDispositionSchema)
    .describe('One entry per finding from the dev-review output'),
  decisionSummaries: z
    .array(DecisionSummarySchema)
    .min(1)
    .describe('Must include DEV_REVIEW_ADDRESSED or DEV_REVIEW_DISMISSED per finding'),
});

export const DevReviewResponseContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
    priority: z.enum(['low', 'medium', 'high', 'critical']),
  }),
  prDiff: z.string().describe('Git diff of the integration worktree vs base branch'),
  devReviewFindings: z
    .array(DevReviewFindingSchema)
    .describe('Findings from the Codex dev-review pass'),
  stack: z
    .object({
      testCommand: z.string().optional(),
      lintCommand: z.string().optional(),
      typecheckCommand: z.string().optional(),
    })
    .optional(),
});

export type FindingDisposition = z.infer<typeof FindingDispositionSchema>;
export type DevReviewResponseOutput = z.infer<typeof DevReviewResponseOutputSchema>;
export type DevReviewResponseContext = z.infer<typeof DevReviewResponseContextSchema>;
