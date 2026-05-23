import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { EvidencePostPlanSchema } from './schema.js';

/**
 * Context expected by the evidence-post agent. Rendered as XML in the user prompt:
 *
 *   <task>
 *     <workItem>{"number":123,"repo":"owner/repo","title":"...","beforeCommentUrl":"..."}</workItem>
 *     <prNumber>...</prNumber>
 *     <prHeadSha>...</prHeadSha>
 *     <specPath>apps/web/e2e/issue-N.spec.ts</specPath>
 *   </task>
 */
export const EvidencePostContextSchema = z.object({
  workItem: z.object({
    number: z.number().describe('Issue number to comment on'),
    repo: z.string().describe('owner/repo, e.g. shaunnez/goose-hub'),
    title: z.string(),
    beforeCommentUrl: z
      .string()
      .url()
      .optional()
      .describe('Permalink to the BEFORE-state comment posted by playwright-repro (type:bug only)'),
  }),
  prNumber: z.number().describe('Pull request number that closes this issue'),
  prHeadSha: z
    .string()
    .min(7)
    .describe('Head commit SHA of the PR — every raw URL must pin to this SHA, never the branch'),
  specPath: z
    .string()
    .describe(
      'Repo-root/worktree-root relative path to the Playwright spec to run, e.g. apps/web/e2e/issue-N.spec.ts',
    ),
});

const config: SkillConfig = {
  contextSchema: EvidencePostContextSchema,
  outputSchema: EvidencePostPlanSchema,
  contextAllowlist: [
    'workItem.number',
    'workItem.repo',
    'workItem.title',
    'workItem.beforeCommentUrl',
    'prNumber',
    'prHeadSha',
    'specPath',
  ],
  /**
   * `validate` bundle is retained for compatibility with the runtime tool
   * profile, but the prompt keeps this skill in planning/verification mode.
   * The workflow owns Playwright, collector parsing, git publishing, and
   * issue comments.
   */
  toolBundles: ['validate'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'developer',
};

export default config;
