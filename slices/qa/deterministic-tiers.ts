import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { runVitest } from '@goose-hub/core/test-runner/run-vitest.js';
import type {
  RegressionPolicy,
  TierResult as VerifyTierResult,
} from '@goose-hub/core/verify/tiers.js';
import type { runTier as defaultRunTier } from '@goose-hub/core/verify/tiers.js';
import type { QaOutput, TestRun } from '@goose-hub/skills/qa/schema.js';
import { type EngineeringSpec, fileOwnedPath } from '@goose-hub/skills/spec-author/schema.js';

export type { TestRun };

export interface VerifyCommand {
  criterionId: string;
  checkId: string;
  ac: string;
  command: string;
  expectedExitCodes: number[];
  outputExpectation?: {
    mode: 'exact' | 'contains' | 'regex';
    value: string;
  };
  evidenceExpectation?:
    | { type: 'exit-code' }
    | { type: 'vitest-json'; suite?: string; testName?: string; expectedStatus: 'passed' };
  timeoutMs?: number;
}

export type DeterministicTierResults = {
  [K in 1 | 2 | 3]: VerifyTierResult | null;
};

export interface DeterministicVerifyOutcome {
  tierResults: DeterministicTierResults;
  /** First tier whose `passed === false` forced a short-circuit. */
  shortCircuitTier?: 1 | 2 | 3;
}

function normalizePath(path: string): string {
  return path.replace(/^\.?\//, '').replace(/\\/g, '/');
}

function pathWithoutTestSuffix(path: string): string {
  return normalizePath(path)
    .replace(/\.(test|spec)\.[cm]?[jt]sx?$/, '')
    .replace(/\.[cm]?[jt]sx?$/, '');
}

function extractPathFromFinding(message: string): string | null {
  const match = message.match(
    /\b((?:apps|core|slices|skills|src|packages)\/[^\s:)'"]+\.(?:test|spec\.)?[cm]?[jt]sx?)\b/,
  );
  return match?.[1] != null ? normalizePath(match[1]) : null;
}

function ownedPathsForSpec(spec: EngineeringSpec): string[] {
  return [
    ...spec.workPackages.flatMap((wp) => wp.filesOwned.map((entry) => fileOwnedPath(entry))),
    ...spec.interfaceContracts.map((contract) => contract.file),
  ].map(normalizePath);
}

function isRelatedFailurePath(failedPath: string, relatedPaths: string[]): boolean {
  const failed = normalizePath(failedPath);
  const failedBase = pathWithoutTestSuffix(failed);
  return relatedPaths.some((relatedPath) => {
    const related = normalizePath(relatedPath);
    const relatedBase = pathWithoutTestSuffix(related);
    return (
      failed === related ||
      failedBase === relatedBase ||
      failed.includes(relatedBase) ||
      related.includes(failedBase)
    );
  });
}

function classifyUnrelatedRegressionFailure(input: {
  result: VerifyTierResult;
  spec: EngineeringSpec;
  changedFiles: string[];
}): VerifyTierResult | null {
  if (input.result.tier !== 3 || input.result.passed) return null;
  const relatedPaths = [...input.changedFiles.map(normalizePath), ...ownedPathsForSpec(input.spec)];
  if (relatedPaths.length === 0) return null;
  const failedPaths = input.result.findings
    .map((finding) => finding.file ?? extractPathFromFinding(finding.message))
    .filter((path): path is string => path != null)
    .map(normalizePath);
  if (failedPaths.length === 0) return null;
  if (failedPaths.some((path) => isRelatedFailurePath(path, relatedPaths))) return null;

  return {
    ...input.result,
    passed: true,
    findings: input.result.findings.map((finding) => ({
      ...finding,
      severity: 'warning',
      category: finding.category ?? 'product',
      code: finding.code ?? 'regression-unrelated',
      message: `Unrelated regression [advisory]: ${finding.message}`,
    })),
    evidence: [
      ...input.result.evidence,
      `regression-unrelated: failed tests outside changed/owned surface (${failedPaths.join(', ')})`,
    ],
  };
}

export async function defaultRunTests(cwd: string, command: string): Promise<TestRun | null> {
  try {
    return await runVitest({ command, cwd });
  } catch {
    return null;
  }
}

export async function runDeterministicTiers(opts: {
  spec: EngineeringSpec;
  worktreePath: string;
  implRunId: string;
  projectSlug: string;
  workItemId: string;
  runId: string;
  regressionPolicy: RegressionPolicy;
  runTier: typeof defaultRunTier;
  changedFiles?: string[];
}): Promise<DeterministicVerifyOutcome> {
  const tierResults: DeterministicTierResults = { 1: null, 2: null, 3: null };
  const runArtifacts = {
    runId: opts.implRunId,
    projectId: opts.projectSlug,
    workItemId: opts.workItemId,
    worktreePath: opts.worktreePath,
    regressionPolicy: opts.regressionPolicy,
  };

  // The `runArtifacts.runId` field is `implRunId` because verifyRegression's
  // wp_iterations carry-forward query is keyed by the implementation run that
  // built the worktree. But the EVENT stream rows we emit for tier 1/2/3
  // pass/fail belong to this QA run — rewrite the runId before persisting so
  // run-scoped queries don't conflate implement and QA stages.
  const tierAppendEvent = (input: Parameters<typeof eventStore.appendEvent>[0]) =>
    eventStore.appendEvent({ ...input, runId: opts.runId });

  for (const tier of [1, 2, 3] as const) {
    const rawResult = await opts.runTier(tier, opts.spec, runArtifacts, {
      appendEvent: tierAppendEvent,
    });
    const result =
      opts.regressionPolicy === 'escalate'
        ? (classifyUnrelatedRegressionFailure({
            result: rawResult,
            spec: opts.spec,
            changedFiles: opts.changedFiles ?? [],
          }) ?? rawResult)
        : rawResult;
    tierResults[tier] = result;
    if (rawResult !== result) {
      tierAppendEvent({
        projectId: opts.projectSlug,
        workItemId: opts.workItemId,
        kind: 'agent.log',
        payload: {
          runId: opts.implRunId,
          skill: 'qa',
          stream: 'telemetry',
          metric: 'regression_unrelated',
          failedTier: tier,
          findingCount: rawResult.findings.length,
          policy: opts.regressionPolicy,
          advisory: true,
        },
        runId: opts.implRunId,
      });
    }
    if (!result.passed) {
      // Tier 1/2 always short-circuit. Tier 3 short-circuits only when policy
      // is 'escalate'; 'ignore' converts the failure to a warning and lets the
      // QA agent run on top of the (still-passed) tier 3 result.
      const escalate = tier !== 3 || opts.regressionPolicy === 'escalate';
      if (escalate) {
        return { tierResults, shortCircuitTier: tier };
      }
      // tier 3 + 'ignore' → verifyRegression already flipped passed=true with
      // warning findings; nothing to short-circuit. Continue to the agent.
    }
  }
  return { tierResults };
}

/**
 * Compare the QA agent's self-reported tier verdicts against deterministic
 * ground truth (M19.19). Disagreement means the agent overrode the harness —
 * we keep ground truth, emit `qa.tier-disagreement`, and treat the agent's
 * output as failed.
 */
export function detectTierDisagreement(
  agent: QaOutput['tierResults'],
  deterministic: DeterministicTierResults,
): Array<{
  tier: 'structural' | 'functional' | 'regression';
  agent: boolean;
  deterministic: boolean;
}> {
  const disagreements: Array<{
    tier: 'structural' | 'functional' | 'regression';
    agent: boolean;
    deterministic: boolean;
  }> = [];
  const pairs = [
    ['structural', 1, agent.structural.passed] as const,
    ['functional', 2, agent.functional.passed] as const,
    ['regression', 3, agent.regression.passed] as const,
  ];
  for (const [name, tier, agentPassed] of pairs) {
    const det = deterministic[tier];
    if (det == null) continue;
    if (det.passed !== agentPassed) {
      disagreements.push({ tier: name, agent: agentPassed, deterministic: det.passed });
    }
  }
  return disagreements;
}

export function toAgentTierResults(
  d: DeterministicTierResults,
): QaOutput['tierResults'] | undefined {
  if (d[1] == null && d[2] == null && d[3] == null) return undefined;
  const map = (vt: VerifyTierResult | null) =>
    vt == null
      ? { passed: true, findings: [] }
      : {
          passed: vt.passed,
          // Findings the agent SEES are message-shaped — we don't need the
          // QA-schema disposition fields here because the agent's allowlist
          // only gives it the structural shape, not the synthetic-output
          // helper. Keep just message + severity for clarity.
          findings: vt.findings.map((f) => ({
            tier:
              vt.tier === 1
                ? ('structural' as const)
                : vt.tier === 2
                  ? ('functional' as const)
                  : ('regression' as const),
            severity: f.severity,
            description: f.message,
          })),
        };
  return {
    structural: map(d[1]),
    functional: map(d[2]),
    regression: map(d[3]),
  } as unknown as QaOutput['tierResults'];
}
