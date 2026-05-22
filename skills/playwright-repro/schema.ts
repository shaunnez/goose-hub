import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

const RepoRelativePathDescription =
  'Repo-root/worktree-root relative POSIX path. Do not use package-relative paths like src/... for files under apps/web; use apps/web/src/....';

export const InvestigationReproPacketSchema = z.object({
  route: z.string().nullable().describe('Route path for the browser repro, or null if unknown'),
  selectors: z.array(z.string()).describe('Known selectors or stable locators for the repro'),
  expectedAssertion: z
    .string()
    .nullable()
    .describe('The visible assertion the repro should prove, or null if unknown'),
  setupRequired: z.array(z.string()).describe('Required auth, localStorage, seed, or UI setup'),
  keyFiles: z.array(
    z.object({ path: z.string().describe(RepoRelativePathDescription), reason: z.string() }),
  ),
  confidence: z.enum(['low', 'medium', 'high']),
  skipBeforeEvidenceEligible: z.boolean().default(false),
});

export const PlaywrightReproSpecSchema = z.object({
  specPath: z
    .string()
    .describe(`${RepoRelativePathDescription} Usually apps/web/e2e/repro-issue-N.spec.ts.`),
  specSource: z
    .string()
    .describe('Complete TypeScript source for the Playwright repro spec at specPath'),
  slug: z.string().describe('Filesystem-safe slug used for /tmp/repro-<slug>'),
  route: z.string().describe('Route the spec navigates to'),
  expectedAssertion: z.string().describe('Assertion proving the reported bug or its absence'),
  reproSteps: z.array(z.string()).describe('Steps encoded by the generated spec'),
  evidenceIntent: z
    .string()
    .describe('Short statement of the evidence this spec is intended to capture'),
  notes: z.string().optional(),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export const PlaywrightReproSchema = z.object({
  screenshots: z.array(
    z.object({
      path: z.string().describe(RepoRelativePathDescription),
      caption: z.string().describe('Description of what this screenshot shows'),
      step: z.number().describe('Repro step number'),
      githubUrl: z
        .string()
        .url()
        .optional()
        .describe('SHA-pinned raw.githubusercontent.com URL once pushed to evidence branch'),
    }),
  ),
  gifPath: z
    .string()
    .nullable()
    .describe(`${RepoRelativePathDescription} Path to walkthrough GIF, or null if not captured.`),
  consoleErrors: z.array(
    z.object({
      message: z.string(),
      type: z.enum(['error', 'warning', 'info']),
      url: z.string().optional(),
    }),
  ),
  testErrors: z
    .array(z.string())
    .default([])
    .describe('Playwright assertion failures from the repro spec'),
  runnerErrors: z
    .array(z.string())
    .default([])
    .describe('Playwright runner, setup, or configuration failures'),
  reproSteps: z.array(z.string()).describe('Steps actually executed to reproduce the bug'),
  reproduced: z.boolean().describe('Whether the bug was successfully reproduced'),
  notes: z.string().optional().describe('Additional context or observations'),
  commentUrl: z
    .string()
    .url()
    .optional()
    .describe('Permalink to the BEFORE-state comment posted on the linked issue'),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type InvestigationReproPacket = z.infer<typeof InvestigationReproPacketSchema>;
export type PlaywrightReproSpecOutput = z.infer<typeof PlaywrightReproSpecSchema>;
export type PlaywrightReproOutput = z.infer<typeof PlaywrightReproSchema>;
