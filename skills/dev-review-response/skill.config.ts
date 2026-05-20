import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { DevReviewResponseContextSchema, DevReviewResponseOutputSchema } from './schema.js';

/**
 * Developer response to Codex dev-review findings (M19.12).
 *
 * Runs AFTER `skills/dev-review/` produces a `blockers-found` or
 * `inconclusive` verdict and BEFORE the PR is opened. The developer
 * receives the findings in context and may edit files in the integration
 * worktree to address them. One run, no second Codex pass.
 *
 * Role is `developer` (not a holdout). `devReviewFindings` is in the
 * context — the `HOLDOUT_FORBIDDEN_KEYS` guard in `context-assembly.ts`
 * ensures this key never leaks to QA or Reviewer specs even if a future
 * caller accidentally adds it to their allowlist.
 *
 * `freshContext: false` — the developer may benefit from short-term
 * run history within the same workflow tick (e.g. which WPs were built).
 */
const config: SkillConfig = {
  contextSchema: DevReviewResponseContextSchema,
  outputSchema: DevReviewResponseOutputSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'workItem.priority',
    'prDiff',
    'devReviewFindings',
    'stack.testCommand',
    'stack.lintCommand',
    'stack.typecheckCommand',
  ],
  toolBundles: ['dev-tools'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'developer',
};

export default config;
export { DevReviewResponseContextSchema };
