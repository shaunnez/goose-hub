import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { EngineeringSpecSchema } from './schema.js';

/**
 * Engineering Spec authoring skill (M19.02, issue #559).
 *
 * Replaces the prior Playwright e2e spec-author content. The skill name
 * is the one Steve uses; PLAN.md §28 (M19) names this skill explicitly
 * as the author of the Engineering Spec consumed by parallel-builder
 * (M19.03) and convergent-review (M19.04).
 *
 * Context (rendered as XML in the user prompt):
 *
 *   <task>
 *     <work_item><title>...</title><body>...</body><number>...</number></work_item>
 *     <issue_type>feature|bug</issue_type>
 *     <worktree_path>/abs/path/to/worktree</worktree_path>
 *     <prd>...</prd>?                      <!-- when type:feature, copied from #313 -->
 *     <scout_reports>[json]</scout_reports>?   <!-- M19.01 Wave-1 reports when present -->
 *     <wave2_reports>[json]</wave2_reports>?   <!-- M19.01 Wave-2 reports when present -->
 *     <repair_feedback>...</repair_feedback>?   <!-- one-shot validator feedback on retry -->
 *   </task>
 */
export const SpecAuthorContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
  }),
  /** Drives the strict-vs-advisory AC→Journey rule. Defaults to feature in the validator. */
  issueType: z.enum(['feature', 'bug']).optional(),
  worktreePath: z.string(),
  /** PRD body (copied from #313 for type:feature). Optional when type:bug. */
  prd: z.string().optional(),
  /** JSON-stringified Wave-1 scout reports (M19.01). Optional fall-back to manual investigation. */
  scoutReports: z.string().optional(),
  /** JSON-stringified Wave-2 deep-agent reports (M19.01). Optional. */
  wave2Reports: z.string().optional(),
  /** JSON-stringified InvestigateOutput (findings, keyFiles, confidence, openQuestions) from the synthesis step. Primary signal; scout reports are supporting evidence. */
  investigationSynthesis: z.string().optional(),
  /** One-shot validation feedback when the workflow retries a mechanically invalid spec. */
  repairFeedback: z.string().optional(),
});

const config: SkillConfig = {
  contextSchema: SpecAuthorContextSchema,
  outputSchema: EngineeringSpecSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'issueType',
    'worktreePath',
    'prd',
    'scoutReports',
    'wave2Reports',
    'investigationSynthesis',
    'repairFeedback',
  ],
  /**
   * Read bundle: spec-author authors a JSON artefact in its terminal
   * output, not files on disk. Persistence to `slices/<n>/spec.json` is
   * orchestrator-side after schema + validator pass.
   */
  toolBundles: ['read'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'developer',
};

export default config;
