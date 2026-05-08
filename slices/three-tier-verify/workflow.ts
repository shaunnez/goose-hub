// slices/three-tier-verify/workflow.ts
// Orchestrates the 3-tier verification cascade (M19.05, issue #562).
// Tier 1 → Tier 2 → Tier 3 in sequence; stops at first failure.

import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import type { AgentEvent, AppendEventInput } from '@goose-hub/core/event-stream/store.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import type { RegressionPolicy, TierDeps, TierResult } from '@goose-hub/core/verify/tiers.js';
import { runTier } from '@goose-hub/core/verify/tiers.js';
import type { EngineeringSpec } from '@goose-hub/skills/spec-author/schema.js';

const TIER_NAMES = { 1: 'Structural', 2: 'Functional', 3: 'Regression' } as const;

export interface ThreeTierVerifyDeps {
  appendEvent?: (input: AppendEventInput) => AgentEvent;
  runTierImpl?: typeof runTier;
}

export interface ThreeTierVerifyResult {
  allPassed: boolean;
  tierResults: TierResult[];
  failedAtTier?: 1 | 2 | 3;
}

/**
 * Run Tier 1 → 2 → 3 in sequence. The orchestrator must not advance to the
 * next tier if the previous one failed (Steve, 03-lifecycle-harness.md:112-118).
 *
 * `implRunId` MUST be the runId from the parallel-implement run that produced
 * the worktree being verified. Tier-3 carry-forward logic queries wp_iterations
 * by this key — using a fresh UUID would make all previouslyOkWpIds empty and
 * disable the regression check entirely.
 *
 * On Tier-3 failure the action depends on `regressionPolicy`:
 * - 'escalate' (default) → transition to factory:needs-human
 * - 'ignore'             → log warning, continue as passed
 * - 'revert'             → caller handles; we still transition to needs-human
 *                          so the human can verify the revert completed cleanly
 */
export async function runThreeTierVerifyWorkflow(
  workItem: WorkItem,
  spec: EngineeringSpec,
  stateSource: StateSource,
  projectId: string,
  worktreePath: string,
  implRunId: string,
  regressionPolicy: RegressionPolicy = 'escalate',
  deps: ThreeTierVerifyDeps = {},
): Promise<ThreeTierVerifyResult> {
  const append = deps.appendEvent ?? ((input) => eventStore.appendEvent(input));
  const runTierFn = deps.runTierImpl ?? runTier;

  const tierDeps: TierDeps = { appendEvent: append };
  const runArtifacts = {
    runId: implRunId,
    projectId,
    workItemId: workItem.id,
    worktreePath,
    regressionPolicy,
    testCommand: undefined, // uses default 'pnpm test'
  };

  const tierResults: TierResult[] = [];

  for (const tier of [1, 2, 3] as const) {
    const result = await runTierFn(tier, spec, runArtifacts, tierDeps);
    tierResults.push(result);

    if (!result.passed) {
      const tierName = TIER_NAMES[tier];
      const errorFindings = result.findings.filter((f) => f.severity === 'error');

      await stateSource.comment(
        workItem.externalId,
        buildAgentComment(
          'QA',
          `Tier ${tier} (${tierName}) Failed`,
          `3-tier verification failed at Tier ${tier} — ${errorFindings.length} error(s)`,
          errorFindings.slice(0, 10).map((f) => f.message),
        ),
      );

      // 'ignore' policy on Tier 3 means non-blocking — all findings are warnings.
      // tier < 3 failures always escalate regardless of policy.
      if (tier < 3 || regressionPolicy !== 'ignore') {
        await stateSource.transitionState(
          workItem.externalId,
          'factory:needs-qa',
          'factory:needs-human',
        );
      }

      return { allPassed: false, tierResults, failedAtTier: tier };
    }
  }

  await stateSource.comment(
    workItem.externalId,
    buildAgentComment('QA', 'Verification Complete', 'All 3 verification tiers passed', [
      'Tier 1 (Structural): passed',
      'Tier 2 (Functional): passed',
      'Tier 3 (Regression): passed',
    ]),
  );

  return { allPassed: true, tierResults };
}
