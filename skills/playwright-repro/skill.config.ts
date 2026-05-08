import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

export const PlaywrightReproContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    reproSteps: z.string().describe('Repro steps extracted from the bug issue body'),
    url: z.string().optional().describe('URL of the page or endpoint exhibiting the bug'),
    number: z.number().describe('Issue number — drives evidence branch name and gh comment'),
    repo: z.string().describe('owner/repo, e.g. shaunnez/goose-hub'),
  }),
  investigation: z
    .object({
      findings: z.string().describe('Root cause hypothesis from the investigate skill'),
      keyFiles: z
        .array(z.object({ path: z.string(), reason: z.string() }))
        .describe('Files identified as most relevant during investigation'),
      confidence: z.enum(['low', 'medium', 'high']),
    })
    .optional()
    .describe('Output from the preceding investigate skill run, when available'),
});

const config: SkillConfig = {
  contextSchema: PlaywrightReproContextSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.reproSteps',
    'workItem.url',
    'workItem.number',
    'workItem.repo',
    'investigation.findings',
    'investigation.keyFiles',
    'investigation.confidence',
  ],
  toolBundles: ['validate'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'investigator',
};

export default config;
