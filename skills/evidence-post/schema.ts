import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

const RepoRelativePathDescription =
  'Repo-root/worktree-root relative POSIX path. Do not use package-relative paths like src/... for files under apps/web; use apps/web/src/....';

/**
 * Screenshot shape mirrors skills/playwright-repro/PlaywrightReproSchema for
 * symmetry — both before- and after-state captures share the same field names.
 */
export const ScreenshotSchema = z.object({
  path: z.string().describe(`${RepoRelativePathDescription} Usually under evidence/issue-<N>/.`),
  caption: z.string().describe('Description of what this screenshot shows'),
  step: z.number().int().describe('Ordinal step in the captured walkthrough'),
  githubUrl: z
    .string()
    .url()
    .optional()
    .describe('SHA-pinned raw.githubusercontent.com URL once pushed to evidence branch'),
});

export const EvidencePostPlanSchema = z.object({
  specPath: z
    .string()
    .describe(
      `${RepoRelativePathDescription} Path to the Playwright spec that validates the shipped work.`,
    ),
  slug: z.string().describe('Filesystem-safe slug used for /tmp/evidence-staging-<slug>'),
  validationIntent: z
    .string()
    .describe('Short statement of what the AFTER-state evidence validates'),
  expectedAssertions: z
    .array(z.string())
    .describe('Assertions the workflow should expect the spec to cover'),
  notes: z.string().optional(),
});

export const EvidencePostSchema = z.object({
  screenshots: z.array(ScreenshotSchema),
  gifPath: z
    .string()
    .nullable()
    .describe(
      `${RepoRelativePathDescription} Path to the GIF walkthrough, or null if not captured.`,
    ),
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

export type EvidencePostPlanOutput = z.infer<typeof EvidencePostPlanSchema>;
export type EvidencePostOutput = z.infer<typeof EvidencePostSchema>;
