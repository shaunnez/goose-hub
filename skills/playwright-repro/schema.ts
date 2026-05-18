import { z } from 'zod';

export const InvestigationReproPacketSchema = z.object({
  route: z.string().nullable().describe('Route path for the browser repro, or null if unknown'),
  selectors: z.array(z.string()).describe('Known selectors or stable locators for the repro'),
  expectedAssertion: z
    .string()
    .nullable()
    .describe('The visible assertion the repro should prove, or null if unknown'),
  setupRequired: z.array(z.string()).describe('Required auth, localStorage, seed, or UI setup'),
  keyFiles: z.array(z.object({ path: z.string(), reason: z.string() })),
  confidence: z.enum(['low', 'medium', 'high']),
  skipBeforeEvidenceEligible: z.boolean().default(false),
});

export const PlaywrightReproSpecSchema = z.object({
  specPath: z
    .string()
    .describe(
      'Workspace-relative Playwright spec path, usually apps/web/e2e/repro-issue-N.spec.ts',
    ),
  slug: z.string().describe('Filesystem-safe slug used for /tmp/repro-<slug>'),
  route: z.string().describe('Route the spec navigates to'),
  expectedAssertion: z.string().describe('Assertion proving the reported bug or its absence'),
  reproSteps: z.array(z.string()).describe('Steps encoded by the generated spec'),
  evidenceIntent: z
    .string()
    .describe('Short statement of the evidence this spec is intended to capture'),
  notes: z.string().optional(),
});

export const PlaywrightReproSchema = z.object({
  screenshots: z.array(
    z.object({
      path: z.string().describe('Workspace-relative path to screenshot file'),
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
    .describe('Workspace-relative path to walkthrough GIF, or null if not captured'),
  consoleErrors: z.array(
    z.object({
      message: z.string(),
      type: z.enum(['error', 'warning', 'info']),
      url: z.string().optional(),
    }),
  ),
  reproSteps: z.array(z.string()).describe('Steps actually executed to reproduce the bug'),
  reproduced: z.boolean().describe('Whether the bug was successfully reproduced'),
  notes: z.string().optional().describe('Additional context or observations'),
  commentUrl: z
    .string()
    .url()
    .optional()
    .describe('Permalink to the BEFORE-state comment posted on the linked issue'),
});

export type InvestigationReproPacket = z.infer<typeof InvestigationReproPacketSchema>;
export type PlaywrightReproSpecOutput = z.infer<typeof PlaywrightReproSpecSchema>;
export type PlaywrightReproOutput = z.infer<typeof PlaywrightReproSchema>;
