import { z } from 'zod';

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

export type PlaywrightReproOutput = z.infer<typeof PlaywrightReproSchema>;
