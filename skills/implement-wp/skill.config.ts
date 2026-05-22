import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { ImplementWpSchema } from './schema.js';

/**
 * Context injected into each WP builder at spawn time (M19.03, ADR 0031).
 *
 * Contains only what a single builder needs: its WP identity, the files it owns,
 * the ACs it must satisfy, parent PRD summary, and the stack commands to run tests and lint.
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
  acceptanceContract: z
    .object({
      source: z.enum(['normalized', 'engineering-spec', 'prd', 'issue-body']),
      criteria: z.array(
        z.object({
          id: z.string(),
          statement: z.string(),
          verifyCommand: z.string().optional(),
          expected: z.string().optional(),
          tolerance: z.string().optional(),
          journeyRef: z.string().optional().nullable(),
          stepIdx: z.number().optional().nullable(),
          crossCutting: z.boolean().optional().nullable(),
          sourceRef: z.string().optional(),
        }),
      ),
    })
    .optional(),
  parentPrdContext: z
    .object({
      source: z.enum(['event', 'legacy-comment']),
      parentWorkItemId: z.string(),
      prdRunId: z.string().nullable(),
      title: z.string(),
      problem: z.string(),
      proposedSolution: z.string(),
      outOfScope: z.array(z.string()),
      successCriteria: z.array(z.string()),
      acceptanceCriteria: z.array(z.unknown()),
      journeys: z.array(z.unknown()),
      functionalSpec: z.unknown().nullable(),
      verticalSlices: z.array(z.unknown()),
      implementationDecisions: z.array(z.unknown()),
      testingDecisions: z.unknown().nullable(),
      artifactRef: z
        .object({
          artifactKey: z.string(),
          kind: z.string(),
          summary: z.string(),
          bytes: z.number(),
          stored: z.literal(true),
        })
        .optional(),
    })
    .optional(),
  stack: z.object({
    testCommand: z.string(),
    lintCommand: z.string().optional(),
    typecheckCommand: z.string().optional(),
  }),
});

const config: SkillConfig = {
  contextSchema: ImplementWpContextSchema,
  outputSchema: ImplementWpSchema,
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
    'acceptanceContract',
    'parentPrdContext',
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
