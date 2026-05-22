import { AcceptanceCriterionContractSchema } from '@goose-hub/core/acceptance-contracts/types.js';
import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { ReviewOutputSchema } from './schema.js';

/**
 * Context keys provided to the Review holdout agent, formatted as structured XML.
 *
 * HOLDOUT DISCIPLINE: The Review agent must never receive developer reasoning.
 * The contextAllowlist explicitly excludes:
 * - devDecisionSummaries (developer implementation decisions)
 * - investigationFindings (root cause analysis from the investigator)
 *
 * The Review agent only sees what a fresh external reviewer would see:
 * the original issue, the diff, and the QA verdict for context.
 *
 *   <task>
 *     <workItem>{"title":"...","body":"...","number":123}</workItem>
 *     <prDiff>...</prDiff>
 *     <qaVerdict>{"verdict":"pass","overallScore":82}</qaVerdict>
 *   </task>
 */
export const ReviewContextSchema = z.object({
  /** The original GitHub issue — acceptance criteria and requirements */
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
  }),
  /** The git diff of the PR being reviewed — what was actually changed */
  prDiff: z.string(),
  /**
   * QA verdict from the prior QA holdout run — used as signal, not directive.
   * The reviewer forms its own independent judgement. QA verdict is context only.
   */
  qaVerdict: z
    .object({
      verdict: z.enum(['pass', 'fail', 'partial']),
      overallScore: z.number(),
    })
    .optional(),
  acceptanceContract: z
    .object({
      source: z.enum(['normalized', 'engineering-spec', 'prd', 'issue-body']),
      criteria: z.array(AcceptanceCriterionContractSchema),
    })
    .optional(),
});

const config: SkillConfig = {
  contextSchema: ReviewContextSchema,
  outputSchema: ReviewOutputSchema,
  /**
   * Tool bundles:
   * - 'read'     — read source files to understand what changed
   * - 'validate' — validate JSON output against the skill schema
   */
  toolBundles: ['read', 'validate'],
  /**
   * Model pin: Review uses sonnet-tier.
   * Criteria checking is structured and systematic — doesn't require opus-level reasoning.
   */
  modelPin: 'sonnet',
  /**
   * freshContext: true — REQUIRED for all holdout roles.
   * The Review agent starts with a clean slate: no memory of developer decisions,
   * no investigation findings, no implementation reasoning.
   * This is the core holdout discipline.
   */
  freshContext: true,
  role: 'reviewer',
  /**
   * contextAllowlist — what the Review agent is permitted to see.
   * Explicitly EXCLUDED: devDecisionSummaries, investigationFindings.
   * The Review agent must independently verify criteria, not rubber-stamp developer reasoning.
   */
  contextAllowlist: ['workItem', 'prDiff', 'qaVerdict', 'acceptanceContract'],
};

export default config;
