import type { DecisionKind } from '@goose-hub/core/agent-runtime/decision-types.js';
import type {
  RegressionPolicy,
  TierResult as VerifyTierResult,
} from '@goose-hub/core/verify/tiers.js';
import type { Finding, QaOutput, TierResult } from '@goose-hub/skills/qa/schema.js';

const ZERO_QUALITY_SCORES: QaOutput['qualityScores'] = {
  openClosed: 0,
  conceptCount: 0,
  timeToCapability: 0,
  complecting: 0,
  loc: 0,
  coupling: 0,
  gallsLaw: 0,
  cyclomaticComplexity: 0,
};

const PASS_TIER_RESULT: TierResult = { passed: true, findings: [] };

const TIER_NAME = { 1: 'structural', 2: 'functional', 3: 'regression' } as const;

const DECISION_KIND_BY_TIER: Record<1 | 2 | 3, DecisionKind> = {
  1: 'STRUCTURAL_CHECK',
  2: 'FUNCTIONAL_CHECK',
  3: 'REGRESSION_CHECK',
};

/** Map a deterministic verify finding into a QA-schema finding. */
function mapVerifyFinding(tier: 1 | 2 | 3, vf: VerifyTierResult['findings'][number]): Finding {
  return {
    tier: TIER_NAME[tier],
    severity: vf.severity,
    description: vf.message,
    ...(vf.file != null ? { file: vf.file } : {}),
    ...(vf.line != null ? { line: vf.line } : {}),
    // Required when severity === 'error' (#468 fix-or-register). The
    // deterministic verifier IS the disposition for synthetic findings:
    // the failure is recorded, the agent is intentionally skipped, and the
    // retry-counter routes to fix-feedback (which gets the chance to fix it).
    ...(vf.severity === 'error'
      ? {
          disposition: 'registered' as const,
          dispositionRef: 'deterministic-verification',
        }
      : {}),
  };
}

function asTierResult(tier: 1 | 2 | 3, vt: VerifyTierResult): TierResult {
  return {
    passed: vt.passed,
    findings: vt.findings.map((f) => mapVerifyFinding(tier, f)),
  };
}

export interface SyntheticQaInputs {
  tierResults: Record<1 | 2 | 3, VerifyTierResult | null>;
  failedTier: 1 | 2 | 3;
  /** Tier-3 policy at the time of failure — included in the summary text. */
  regressionPolicy?: RegressionPolicy;
}

/**
 * Build a `QaOutput`-shaped payload for the case where deterministic verify
 * already failed and the QA agent was intentionally skipped (M19.19). The
 * payload conforms to `QaOutputSchema` so all downstream consumers (UI, retro,
 * retry-counter, persona stats) handle it unchanged.
 *
 * Tiers earlier than `failedTier` are reported with their actual deterministic
 * result. The failed tier is reported with `passed: false` and its findings.
 * Tiers after `failedTier` were never run — they are emitted as a passing
 * vacuous result so the schema shape stays complete.
 */
export function buildSyntheticQaOutput({
  tierResults,
  failedTier,
  regressionPolicy,
}: SyntheticQaInputs): QaOutput {
  const tier1 = tierResults[1];
  const tier2 = tierResults[2];
  const tier3 = tierResults[3];

  const structural: TierResult = tier1 ? asTierResult(1, tier1) : PASS_TIER_RESULT;
  const functional: TierResult = tier2 ? asTierResult(2, tier2) : PASS_TIER_RESULT;
  const regression: TierResult = tier3 ? asTierResult(3, tier3) : PASS_TIER_RESULT;

  const findings: Finding[] = [
    ...structural.findings,
    ...functional.findings,
    ...regression.findings,
  ];

  const policySuffix =
    failedTier === 3 && regressionPolicy != null ? ` (policy: ${regressionPolicy})` : '';
  const summary = `Tier ${failedTier} failed deterministic verification — QA agent skipped${policySuffix}`;

  return {
    verdict: 'fail',
    overallScore: 0,
    threshold: 70,
    tierResults: { structural, functional, regression },
    qualityScores: { ...ZERO_QUALITY_SCORES },
    findings,
    decisionSummaries: [{ kind: DECISION_KIND_BY_TIER[failedTier], summary }],
  };
}
