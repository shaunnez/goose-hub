import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

/**
 * Context keys provided to the QA holdout agent, formatted as structured XML.
 *
 * HOLDOUT DISCIPLINE: The QA agent must never receive developer reasoning.
 * The contextAllowlist explicitly excludes:
 * - devDecisionSummaries (developer implementation decisions)
 * - investigationFindings (root cause analysis from the investigator)
 *
 * The QA agent only sees what a fresh external reviewer would see:
 * the original issue, the diff, and the commands needed to verify it.
 *
 *   <task>
 *     <work_item>
 *       <title>...</title>
 *       <body>...</body>
 *       <number>...</number>
 *     </work_item>
 *     <pr_diff>...</pr_diff>
 *     <project_commands>
 *       <test_command>...</test_command>
 *       <lint_command>...</lint_command>
 *       <e2e_command>...</e2e_command>
 *     </project_commands>
 *     <slice_tests>
 *       <path>...</path>
 *     </slice_tests>
 *   </task>
 */
export const QaContextSchema = z.object({
  /** The original GitHub issue — acceptance criteria and requirements */
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
  }),
  /** The git diff of the PR being reviewed — what was actually changed */
  prDiff: z.string(),
  /** Shell commands to run verification — project-specific */
  projectCommands: z.object({
    testCommand: z.string(),
    lintCommand: z.string().optional(),
    e2eCommand: z.string().optional(),
  }),
  /** Paths to slice-level test files for targeted test runs */
  sliceTests: z.array(z.string()).optional(),
});

const config: SkillConfig = {
  contextSchema: QaContextSchema,
  /**
   * Tool bundles:
   * - 'read'     — read source files to understand what changed
   * - 'shell'    — run lint, tests, and e2e commands
   * - 'validate' — validate JSON output against the skill schema
   */
  toolBundles: ['read', 'shell', 'validate'],
  /**
   * Model pin: QA uses sonnet-tier.
   * Verification is structured and repeatable — doesn't require opus-level reasoning.
   */
  modelPin: 'sonnet',
  /**
   * freshContext: true — REQUIRED for all holdout roles.
   * The QA agent starts with a clean slate: no memory of developer decisions,
   * no investigation findings, no implementation reasoning.
   * This is the core holdout discipline.
   */
  freshContext: true,
  role: 'qa',
  /**
   * contextAllowlist — what the QA agent is permitted to see.
   * Explicitly EXCLUDED: devDecisionSummaries, investigationFindings.
   * The QA agent must independently verify, not rubber-stamp developer reasoning.
   */
  contextAllowlist: ['workItem', 'prDiff', 'projectCommands', 'sliceTests'],
};

export default config;
