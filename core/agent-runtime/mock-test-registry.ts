/**
 * Per-issue test outcome registry for deterministic E2E pipeline specs.
 * Only consulted when MOCK_AGENTS=true.
 *
 * Outcomes are consumed queue-style: each call to getNextOutcome pops the
 * first entry; the last entry is kept so subsequent calls use the final value.
 */

interface IssueTestConfig {
  outcomeQueues: Partial<Record<string, string[]>>;
  throwMergeConflict?: boolean;
}

const registry = new Map<string, IssueTestConfig>();

export function registerTestOutcomes(
  workItemId: string,
  config: {
    outcomes?: Partial<Record<string, string | string[]>>;
    throwMergeConflict?: boolean;
  },
): void {
  const outcomeQueues: Partial<Record<string, string[]>> = {};
  for (const [skill, outcome] of Object.entries(config.outcomes ?? {})) {
    if (outcome == null) continue;
    outcomeQueues[skill] = Array.isArray(outcome) ? [...outcome] : [outcome];
  }
  registry.set(workItemId, {
    outcomeQueues,
    throwMergeConflict: config.throwMergeConflict ?? false,
  });
}

export function getNextOutcome(workItemId: string | undefined, skill: string): string | undefined {
  if (workItemId == null) return undefined;
  const config = registry.get(workItemId);
  if (!config) return undefined;
  const queue = config.outcomeQueues[skill];
  if (!queue || queue.length === 0) return undefined;
  if (queue.length === 1) return queue[0];
  return queue.shift();
}

export function checkAndClearMergeConflict(workItemId: string): boolean {
  const config = registry.get(workItemId);
  if (!config?.throwMergeConflict) return false;
  registry.set(workItemId, { ...config, throwMergeConflict: false });
  return true;
}

export function clearTestConfig(workItemId: string): void {
  registry.delete(workItemId);
}
