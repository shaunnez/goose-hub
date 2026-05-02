import { z } from 'zod';

export const DecisionSummarySchema = z.object({
  step: z.string(),
  summary: z.string(),
  evidence: z.string().optional(),
});

/**
 * Screenshot shape mirrors skills/playwright-repro/PlaywrightReproSchema for
 * symmetry — both before- and after-state captures share the same field names.
 */
export const ScreenshotSchema = z.object({
  path: z.string().describe('Workspace-relative path under evidence/issue-<N>/'),
  caption: z.string().describe('Description of what this screenshot shows'),
  step: z.number().int().describe('Ordinal step in the captured walkthrough'),
});

export const EvidencePostSchema = z.object({
  screenshots: z.array(ScreenshotSchema),
  videoPath: z
    .string()
    .nullable()
    .describe('Workspace-relative path to the WebM walkthrough, or null if not captured'),
  commentUrl: z.string().url().describe('Permalink to the comment posted on the linked issue'),
  commitSha: z
    .string()
    .min(7)
    .describe('Full or short SHA the raw.githubusercontent.com URLs pin to (NEVER the branch)'),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type EvidencePostOutput = z.infer<typeof EvidencePostSchema>;
