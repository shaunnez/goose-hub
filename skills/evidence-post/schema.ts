import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

/**
 * Screenshot shape mirrors skills/playwright-repro/PlaywrightReproSchema for
 * symmetry — both before- and after-state captures share the same field names.
 */
export const ScreenshotSchema = z.object({
  path: z.string().describe('Workspace-relative path under evidence/issue-<N>/'),
  caption: z.string().describe('Description of what this screenshot shows'),
  step: z.number().int().describe('Ordinal step in the captured walkthrough'),
  githubUrl: z
    .string()
    .url()
    .optional()
    .describe('SHA-pinned raw.githubusercontent.com URL once pushed to evidence branch'),
});

export const EvidencePostSchema = z.object({
  screenshots: z.array(ScreenshotSchema),
  gifPath: z
    .string()
    .nullable()
    .describe('Workspace-relative path to the GIF walkthrough, or null if not captured'),
  commentUrl: z
    .string()
    .url()
    .optional()
    .describe('Permalink to the comment posted on the linked issue; absent when spec failed'),
  commitSha: z
    .string()
    .min(7)
    .optional()
    .describe(
      'Full or short SHA the raw.githubusercontent.com URLs pin to (NEVER the branch); absent when no artefacts were pushed',
    ),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type EvidencePostOutput = z.infer<typeof EvidencePostSchema>;
