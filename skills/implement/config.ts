import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

/**
 * Context expected by the implement skill. Rendered as XML in the user prompt:
 *
 *   <task>
 *     <work_item>
 *       <title>...</title>
 *       <body>...</body>
 *       <number>...</number>
 *       <priority>...</priority>
 *     </work_item>
 *     <worktree_path>/abs/path/to/worktree</worktree_path>
 *     <stack>
 *       <test_command>pnpm test</test_command>
 *       <lint_command>pnpm lint</lint_command>            <!-- optional -->
 *       <typecheck_command>pnpm typecheck</typecheck_command>  <!-- optional -->
 *     </stack>
 *     <advisor_feedback>...</advisor_feedback>             <!-- optional, when revising -->
 *     <revision_pass>0 | 1</revision_pass>                 <!-- optional, default 0 -->
 *   </task>
 */
export const ImplementContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
    priority: z.enum(['low', 'medium', 'high', 'critical']),
  }),
  worktreePath: z.string().describe('Absolute path to the checked-out worktree to implement in'),
  stack: z.object({
    testCommand: z.string(),
    lintCommand: z.string().optional(),
    typecheckCommand: z.string().optional(),
  }),
  advisorFeedback: z.string().optional(),
  revisionPass: z.union([z.literal(0), z.literal(1)]).optional(),
});

const config: SkillConfig = {
  contextSchema: ImplementContextSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'workItem.priority',
    'worktreePath',
    'stack.testCommand',
    'stack.lintCommand',
    'stack.typecheckCommand',
    'advisorFeedback',
    'revisionPass',
  ],
  /**
   * `dev-tools` bundle — read, search, work-item-read, write, bash, test
   * (M7.01, #179). All workspace-bound and bash-denylist enforced.
   */
  toolBundles: ['dev-tools'],
  /**
   * Pinned to sonnet — routine implementation work. Opus is reserved for
   * the advisor and the investigator (deep reasoning). Sonnet handles the
   * RGR loop reliably.
   */
  modelPin: 'sonnet',
  /**
   * `freshContext: false` — implementer sees prior decision summaries from
   * advisor and prior runs. Per CONTEXT.md the implementer is NOT a holdout.
   */
  freshContext: false,
  role: 'developer',
};

export default config;
