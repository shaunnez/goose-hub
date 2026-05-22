import { AcceptanceCriterionContractSchema } from '@goose-hub/core/acceptance-contracts/types.js';
import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { ImplementSchema } from './schema.js';

/**
 * Context expected by the implement skill. Rendered as XML in the user prompt:
 *
 *   <task>
 *     <workItem>{"title":"...","body":"...","number":123,"priority":"medium"}</workItem>
 *     <stack>{"testCommand":"pnpm test","lintCommand":"pnpm lint","typecheckCommand":"pnpm typecheck"}</stack>
 *     <advisorFeedback>...</advisorFeedback>               <!-- optional, when revising -->
 *     <revisionPass>0 | 1</revisionPass>                   <!-- optional, default 0 -->
 *   </task>
 */
export const ImplementContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
    priority: z.enum(['low', 'medium', 'high', 'critical']),
  }),
  stack: z.object({
    testCommand: z.string(),
    lintCommand: z.string().optional(),
    typecheckCommand: z.string().optional(),
  }),
  advisorFeedback: z.string().optional(),
  revisionPass: z.union([z.literal(0), z.literal(1)]).optional(),
  evidencePostEnabled: z.boolean().optional(),
  acceptanceContract: z
    .object({
      source: z.enum(['normalized', 'engineering-spec', 'prd', 'issue-body']),
      criteria: z.array(AcceptanceCriterionContractSchema),
    })
    .optional(),
});

const config: SkillConfig = {
  contextSchema: ImplementContextSchema.extend({
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
    relatedSurface: z
      .object({
        keyFiles: z.array(z.object({ path: z.string(), reason: z.string().optional() })),
        packageRoots: z.array(z.string()),
        existingTests: z.array(z.string()),
        testCandidates: z.array(z.string()),
        evidenceSpecPath: z.string().nullable(),
        checkedAbsent: z.array(z.string()),
        targetedTestPaths: z.array(z.string()),
        readFirst: z.array(z.string()),
        primaryTestPath: z.string().nullable(),
        testMode: z.enum(['update-existing', 'create-candidate', 'no-test-surface']),
        doNotSearchFor: z.array(z.string()),
      })
      .optional(),
  }),
  outputSchema: ImplementSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'workItem.priority',
    'stack.testCommand',
    'stack.lintCommand',
    'stack.typecheckCommand',
    'investigation',
    'relatedSurface',
    'advisorFeedback',
    'revisionPass',
    'evidencePostEnabled',
    'acceptanceContract',
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
