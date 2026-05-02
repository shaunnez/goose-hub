import { z } from 'zod';

export const PlaywrightReproSchema = z.object({
  screenshots: z.array(
    z.object({
      path: z.string().describe('Absolute path to screenshot file'),
      caption: z.string().describe('Description of what this screenshot shows'),
      step: z.number().describe('Repro step number'),
    }),
  ),
  videoPath: z.string().nullable().describe('Absolute path to video recording if captured'),
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
});

export type PlaywrightReproOutput = z.infer<typeof PlaywrightReproSchema>;
