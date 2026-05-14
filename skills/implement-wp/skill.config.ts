import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

/**
 * Context injected into each WP builder at spawn time (M19.03, ADR 0031).
 *
 * Contains only what a single builder needs: its WP identity, the files it owns,
 * the ACs it must satisfy, and the stack commands to run tests and lint.
 *
 * Full-repo context is intentionally excluded — the builder sees only its slice
 * of the problem plus the code snippets pre-loaded by the spec-author scout wave.
 */
export const ImplementWpContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
    priority: z.enum(['low', 'medium', 'high', 'critical']),
  }),
  wp: z.object({
    id: z.string().min(1),
    filesOwned: z.array(z.string().min(1)).min(1),
    changes: z.string().min(1),
    dependsOn: z.array(z.string()),
  }),
  /** Code snippets from the spec-author scout wave, narrowed to this WP's scope. */
  codeSnippets: z.array(z.string()).optional(),
  investigation: z
    .object({
      findings: z.string().optional(),
      keyFiles: z
        .array(
          z.object({
            path: z.string(),
            reason: z.string().optional(),
          }),
        )
        .optional(),
      openQuestions: z.array(z.string()).optional(),
      investigationRunId: z.string().optional(),
    })
    .optional(),
  worktreePath: z.string().describe('Absolute path to the WP scratch worktree'),
  stack: z.object({
    testCommand: z.string(),
    lintCommand: z.string().optional(),
    typecheckCommand: z.string().optional(),
  }),
});

const config: SkillConfig = {
  contextSchema: ImplementWpContextSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'workItem.priority',
    'wp.id',
    'wp.filesOwned',
    'wp.changes',
    'wp.dependsOn',
    'codeSnippets',
    'investigation',
    'worktreePath',
    'stack.testCommand',
    'stack.lintCommand',
    'stack.typecheckCommand',
  ],
  /**
   * `dev-tools` bundle — read, search, work-item-read, write, bash, test.
   * The orchestrator additionally sets the sandbox denylist to include
   * `Bash(git *)` via `writeWpBuilderSandbox()`, so git operations are
   * hard-blocked at the tool layer (ADR 0031, rule 37).
   */
  toolBundles: ['dev-tools'],
  /**
   * Pinned to sonnet by default; orchestrator may upgrade to opus for WPs
   * whose `builderTier` is 'opus' (per EngineeringSpec).
   */
  modelPin: 'sonnet',
  freshContext: false,
  role: 'developer',
};

export default config;
