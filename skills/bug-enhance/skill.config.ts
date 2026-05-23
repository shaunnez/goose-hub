import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { BugEnhanceOutputSchema } from './schema.js';

export const BugEnhanceContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
  }),
});

const config: SkillConfig = {
  contextSchema: BugEnhanceContextSchema,
  outputSchema: BugEnhanceOutputSchema,
  contextAllowlist: ['workItem'],
  // bug-enhance grounds UI bug reports against the actual codebase via
  // read-only tools: repo_intel.query (route-for-url, fuzzy-component,
  // recent-touched, find-component), search_text, list_dir, read_file.
  // The prompt enforces a tight tool-call cap so this stays a small,
  // cheap pass; maxTurns is the hard ceiling.
  toolBundles: ['read'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'triager',
};

export default config;
