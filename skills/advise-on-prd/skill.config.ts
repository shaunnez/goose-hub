import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

/**
 * Context expected by the PRD advisor.
 *
 * The advisor only sees the PRD JSON output and the work item priority.
 * It never sees grill-me history, implementation reasoning, or chat history.
 *
 * `priority` is all four values — the skill is invoked by the workflow only
 * for `high` and `critical` (budget-gated), but the skill itself does not gate.
 * The workflow checks `perAdvisorMaxUsd` before invocation.
 */
export const AdvisePRDContextSchema = z.object({
  prdOutput: z.unknown().describe('The PRD JSON produced by the write-prd skill'),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
});

const config: SkillConfig = {
  contextSchema: AdvisePRDContextSchema,
  contextAllowlist: ['prdOutput', 'priority'],
  /**
   * Advisor runs with read + core bundles so it can inspect the codebase and
   * check the PRD against existing patterns, but cannot write or execute.
   */
  toolBundles: ['read', 'core'],
  /**
   * Pinned to opus: the PRD advisor reviews the write-prd skill's output in
   * fresh context, requiring the higher-tier model for cross-cutting PRD critique.
   */
  modelPin: 'opus',
  /**
   * freshContext: true — advisor sees only what's in contextAllowlist.
   * Never ambient event-stream entries, persona history, or developer decision summaries.
   * CONTEXT.md "Context Assembly and Holdout Enforcement".
   */
  freshContext: true,
  /**
   * Role: prd-writer running in advisor mode — the PRD advisor is the same
   * role as the primary PRD writer, but scoped to review only.
   */
  role: 'prd-writer',
};

export default config;
