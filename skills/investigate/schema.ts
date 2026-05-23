import { DecisionSummarySchema } from '@goose-hub/core/retrospective/schemas.js';
import { z } from 'zod';

export { DecisionSummarySchema };

const RepoRelativePathDescription =
  'Repo-root/worktree-root relative POSIX path. Do not use package-relative paths like src/... for files under apps/web; use apps/web/src/....';

export const KeyFileSchema = z.object({
  path: z.string().describe(RepoRelativePathDescription),
  reason: z.string(),
  line: z.number().int().min(1).optional(),
  symbol: z.string().optional(),
  snippet: z.string().max(800).optional(),
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
  fixHint: z
    .object({
      file: z.string().describe(RepoRelativePathDescription),
      line: z.number().int().min(1),
      currentCode: z.string().max(1200),
      suggestedApproach: z.string(),
    })
    .optional(),
});

export type KeyFile = z.infer<typeof KeyFileSchema>;
export type InvestigateOutput = z.infer<typeof InvestigateSchema>;
