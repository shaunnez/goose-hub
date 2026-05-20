import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';
import { QaOutputSchema, TestRunSchema, VerificationSummarySchema } from './schema.js';

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
 *     <workItem>{"title":"...","body":"...","number":123}</workItem>
 *     <prDiff>...</prDiff>
 *     <projectCommands>{"testCommand":"...","lintCommand":"...","e2eCommand":"..."}</projectCommands>
 *     <verificationSummary>{"changedFiles":...,"commands":...,"testRun":...}</verificationSummary>
 *     <sliceTests>["path/to/test.ts"]</sliceTests>
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
  e2eDecision: z
    .object({
      mode: z.enum(['off', 'ui-changed', 'always']),
      command: z.string().optional(),
      reason: z.string(),
    })
    .optional(),
  /** Paths to slice-level test files for targeted test runs */
  sliceTests: z.array(z.string()).optional(),
  /** Permalink to the evidence-post comment (screenshots + GIF) on the GitHub issue; absent for backend-only changes or when evidence capture failed */
  evidenceCommentUrl: z.string().url().optional(),
  /**
   * Per-AC verify commands extracted from the issue body by the orchestrator.
   * The QA agent runs each command and records a criteriaResult per entry.
   */
  verifyCommands: z
    .array(
      z.object({
        ac: z.string(),
        command: z.string(),
        expected: z.string(),
        tolerance: z.string(),
      }),
    )
    .optional(),
  /**
   * The targeted test command and paths the developer actually ran (#467).
   * Sourced from the implement skill's `testsRun` output. QA cross-references
   * this against its own full-suite run to flag failures outside dev's
   * targeted set as high-signal regressions. Optional — older runs (or
   * non-implement workflows) won't have it.
   */
  devTestsRun: z
    .object({
      command: z.string(),
      paths: z.array(z.string()),
    })
    .optional(),
  /** Structured test results captured by the workflow before the QA agent starts. */
  testRun: TestRunSchema.nullable().optional(),
  /**
   * Compact workflow-owned verification packet. Contains deterministic command
   * statuses and evidence metadata only, never implementation reasoning.
   */
  verificationSummary: VerificationSummarySchema.optional(),
});

const config: SkillConfig = {
  contextSchema: QaContextSchema,
  outputSchema: QaOutputSchema,
  /**
   * Tool bundles:
   * - 'read'     — read source files to understand what changed
   * - 'qa-tools' — read-only verification commands for targeted uncertainty
   *
   * The workflow owns lint/typecheck/test/e2e execution when it can provide
   * structured verificationSummary results. QA should grade those packets
   * before spending shell calls.
   */
  toolBundles: ['read', 'qa-tools'],
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
  contextAllowlist: [
    'workItem',
    'prDiff',
    'projectCommands',
    'e2eDecision',
    'sliceTests',
    'evidenceCommentUrl',
    'verifyCommands',
    'devTestsRun',
    'testRun',
    'verificationSummary',
  ],
};

export default config;
