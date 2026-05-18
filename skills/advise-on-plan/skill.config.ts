import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { AdviseOnPlanSchema } from './schema.js';

/**
 * Context expected by the advisor. Rendered as XML in the user prompt:
 *
 *   <task>
 *     <workItem>{"title":"...","body":"...","number":123,"priority":"high"}</workItem>
 *     <plan>...the developer's plan text...</plan>
 *     <revisionPass>0 | 1</revisionPass>                       <!-- optional -->
 *     <previousAdvisorFeedback>...</previousAdvisorFeedback>    <!-- present when revisionPass === 1 -->
 *   </task>
 *
 * `priority` constrained to `high | critical` because the orchestrator only
 * invokes the advisor for these two priorities (FACTORY_RULES rule 22 + the
 * skill prompt's gating). Validation rejects other values to surface
 * orchestrator bugs early.
 */
export const AdviseOnPlanContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
    priority: z.enum(['high', 'critical']),
  }),
  plan: z.string().describe("The developer's written plan to be reviewed"),
  revisionPass: z
    .union([z.literal(0), z.literal(1)])
    .optional()
    .describe('Advisor pass index. Omitted == 0 (first pass). 1 == informed second pass.'),
  previousAdvisorFeedback: z
    .string()
    .optional()
    .describe('Advisor own pass-0 output, present only when revisionPass === 1'),
});

const config: SkillConfig = {
  contextSchema: AdviseOnPlanContextSchema,
  outputSchema: AdviseOnPlanSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'workItem.priority',
    'plan',
    'revisionPass',
    'previousAdvisorFeedback',
  ],
  /**
   * Advisor runs in fresh context: no implementation reasoning, no developer
   * decision summaries, no chat history. The `read` bundle gives the advisor
   * sandboxed access to the workspace so it can sanity-check the plan against
   * the actual code, but no write/exec capability.
   */
  toolBundles: ['read'],
  /**
   * Pinned to opus per the advisor pattern: a higher-tier model reviewing a
   * primary's output in fresh context. Sonnet is sufficient for routine
   * implementations; opus catches the cross-cutting issues an advisor exists
   * to flag.
   */
  modelPin: 'opus',
  /**
   * `freshContext: true` — advisor sees only what's in `contextAllowlist`,
   * never ambient event-stream entries or persona history. CONTEXT.md
   * "Context Assembly and Holdout Enforcement" — guards against ambient
   * injection of developer reasoning.
   */
  freshContext: true,
  /**
   * Role: advisor is structurally distinct from the holdouts (qa, reviewer)
   * — it CAN see prior advisor feedback on revision passes, while holdouts
   * see nothing. Roles are constrained by `core/types.ts:Role`. Closest
   * existing role that doesn't include reasoning leakage is `researcher`.
   */
  role: 'researcher',
};

export default config;
