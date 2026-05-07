import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

export const KeyFileSchema = z.object({
  path: z.string(),
  reason: z.string(),
});

export const InvestigateSchema = z.object({
  findings: z.string().describe('Root cause hypothesis and analysis'),
  keyFiles: z.array(KeyFileSchema).describe('Files most relevant to the bug'),
  confidence: z.enum(['low', 'medium', 'high']),
  openQuestions: z.array(z.string()).describe('Unresolved questions requiring more investigation'),
  requiresBrowserRepro: z
    .boolean()
    .describe(
      'True if the bug manifests in the browser UI and can be reproduced via Playwright. False for pure server-side/API bugs where a browser repro is meaningless.',
    ),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export type KeyFile = z.infer<typeof KeyFileSchema>;
export type InvestigateOutput = z.infer<typeof InvestigateSchema>;
