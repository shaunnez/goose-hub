import { AcceptanceCriterionContractSchema } from '@goose-hub/core/acceptance-contracts/types.js';
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
 *     <prDiff>Diff context; large diffs may be a digest plus artifact reference.</prDiff>
 *     <prDiffWithContext>{"changedFiles":["..."],"hunks":[...]}</prDiffWithContext>
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
  /** Diff context for the PR. Small diffs are inline; large diffs may be summarized with an artifact reference. */
  prDiff: z.string(),
  /** Diff-derived changed-file and hunk metadata. Contains no developer or investigation reasoning. */
  prDiffWithContext: z
    .object({
      changedFiles: z.array(z.string()),
      hunkCount: z.number().int().min(0),
      hunks: z.array(
        z.object({
          file: z.string(),
          oldStart: z.number().int().min(0),
          oldLines: z.number().int().min(0),
          newStart: z.number().int().min(0),
          newLines: z.number().int().min(0),
          heading: z.string().optional(),
        }),
      ),
      diffCharCount: z.number().int().min(0),
    })
    .optional(),
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
   * Workflow-owned executable check results. The QA agent grades/explains
   * these results but must not override command truth.
   */
  criteriaResults: z
    .array(
      z.object({
        criterionId: z.string(),
        checkId: z.string(),
        ac: z.string(),
        command: z.string(),
        expectedExitCodes: z.array(z.number().int()).min(1),
        exitCode: z.number().int().nullable(),
        actual: z.string(),
        passed: z.boolean(),
        outputExpectation: z
          .object({
            mode: z.enum(['exact', 'contains', 'regex']),
            value: z.string(),
          })
          .optional(),
        evidenceExpectation: z
          .discriminatedUnion('type', [
            z.object({ type: z.literal('exit-code') }),
            z.object({
              type: z.literal('vitest-json'),
              suite: z.string().optional(),
              testName: z.string().optional(),
              expectedStatus: z.literal('passed'),
            }),
          ])
          .optional(),
        evidenceArtifact: z
          .object({
            type: z.enum(['vitest-json', 'process']),
            summary: z.object({
              total: z.number().int().min(0),
              passed: z.number().int().min(0),
              failed: z.number().int().min(0),
              skipped: z.number().int().min(0),
            }),
            matchedSuites: z.array(z.string()),
            matchedTests: z.array(z.string()),
            artifactStatus: z.enum(['matched', 'not-found', 'unavailable']),
          })
          .optional(),
        durationMs: z.number().int().min(0).optional(),
        error: z.string().optional(),
      }),
    )
    .optional(),
  acceptanceContract: z
    .object({
      source: z.enum(['normalized', 'engineering-spec', 'prd', 'issue-body']),
      criteria: z.array(AcceptanceCriterionContractSchema),
    })
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
  /** Legacy raw test results. New QA workflow context uses compact verificationSummary.testRun instead. */
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
    'prDiffWithContext',
    'projectCommands',
    'e2eDecision',
    'sliceTests',
    'evidenceCommentUrl',
    'criteriaResults',
    'acceptanceContract',
    'devTestsRun',
    'verificationSummary',
  ],
};

export default config;
