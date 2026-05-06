import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

/**
 * Context keys expected by the investigator agent, formatted as structured XML:
 *
 *   <task>
 *     <work_item>
 *       <title>...</title>
 *       <body>...</body>
 *       <number>...</number>
 *     </work_item>
 *     <worktree_path>...</worktree_path>
 *   </task>
 *
 * - workItem.title   — the issue title (used as starting investigation signal)
 * - workItem.body    — the issue body (contains steps to reproduce, expected/actual behaviour)
 * - workItem.number  — the issue number (used for references in decision summaries)
 * - worktreePath     — absolute path to the checked-out worktree to investigate
 */
export const InvestigateContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
  }),
  worktreePath: z.string(),
});

const config: SkillConfig = {
  contextSchema: InvestigateContextSchema,
  /**
   * Tool bundle 'read' maps to ['read', 'search', 'work-item-read'].
   * The investigator has NO write access — file writes will be rejected.
   */
  toolBundles: ['read'],
  /**
   * Model pin: investigator is opus-tier.
   * PLAN.md explicitly states "no advisor on investigator, already opus-tier".
   * Opus is used because root-cause analysis requires deep reasoning over
   * potentially large amounts of unfamiliar code.
   */
  modelPin: 'opus',
  freshContext: false,
  role: 'investigator',
};

export default config;
