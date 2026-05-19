import type { RuntimeProfilerMetrics, RuntimeProfilerRecommendation } from './types.js';

export function recommendRuntimeProfile(input: {
  skill: string;
  metrics: RuntimeProfilerMetrics;
}): RuntimeProfilerRecommendation[] {
  const { skill, metrics } = input;
  const recommendations: RuntimeProfilerRecommendation[] = [];

  if (metrics.timeoutRate >= 0.2) {
    recommendations.push({
      kind: 'timeout',
      severity: metrics.timeoutRate >= 0.4 ? 'critical' : 'warning',
      summary: 'Timeout rate is high for this skill.',
      evidence: `${percent(metrics.timeoutRate)} of observed runs timed out.`,
      suggestedPatch: { timeoutMs: 'increase' },
    });
  }

  if (metrics.budgetExceededRate >= 0.1) {
    recommendations.push({
      kind: 'budget',
      severity: metrics.budgetExceededRate >= 0.25 ? 'critical' : 'warning',
      summary: 'Budget pressure is visible in run history.',
      evidence: `${percent(metrics.budgetExceededRate)} of observed runs hit a budget gate.`,
      suggestedPatch: { effort: 'lower', modelTier: 'lower', maxBudgetUsd: 'review' },
    });
  }

  if (metrics.schemaValidationRetryRate >= 0.15) {
    recommendations.push({
      kind: 'schema-validation',
      severity: 'warning',
      summary: 'Schema repair or retry events are common.',
      evidence: `${percent(metrics.schemaValidationRetryRate)} of observed runs needed repair or retry.`,
      suggestedPatch: { effort: 'higher' },
    });
  }

  const bashCount = metrics.topToolNames.find((tool) => tool.name === 'Bash')?.count ?? 0;
  if (metrics.runCount > 0 && bashCount / metrics.runCount >= 12) {
    recommendations.push({
      kind: 'tool-discipline',
      severity: 'info',
      summary: 'This skill leans heavily on shell exploration.',
      evidence: `${bashCount} Bash calls across ${metrics.runCount} runs.`,
    });
  }

  const repeated = metrics.repeatedBashCommands[0];
  if (repeated != null && repeated.count >= 3) {
    recommendations.push({
      kind: 'workflow-helper',
      severity: 'info',
      summary: 'A repeated command pattern may deserve a deterministic helper.',
      evidence: `${repeated.count} repeats of: ${repeated.command}`,
    });
  }

  if (
    metrics.runCount >= 5 &&
    metrics.p95CostUsd <= 0.2 &&
    metrics.timeoutRate === 0 &&
    metrics.budgetExceededRate === 0 &&
    metrics.schemaValidationRetryRate === 0
  ) {
    recommendations.push({
      kind: 'lower-runtime',
      severity: 'info',
      summary: 'This skill looks stable and inexpensive.',
      evidence: `p95 cost is $${metrics.p95CostUsd.toFixed(4)} across ${metrics.runCount} runs.`,
      suggestedPatch: { effort: 'low', modelTier: 'lower' },
    });
  }

  if (skill === 'qa' && hasE2eSequence(metrics)) {
    recommendations.push({
      kind: 'qa-e2e-boundary',
      severity: 'warning',
      summary: 'QA appears to be running browser/e2e commands.',
      evidence: 'Observed command sequences include Playwright, browser, or e2e terms.',
    });
  }

  return recommendations;
}

function hasE2eSequence(metrics: RuntimeProfilerMetrics): boolean {
  const text = [
    ...metrics.commonCommandSequences.map((entry) => entry.sequence.join(' ')),
    ...metrics.repeatedBashCommands.map((entry) => entry.command),
  ]
    .join(' ')
    .toLowerCase();
  return text.includes('playwright') || text.includes('e2e') || text.includes('browser');
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
