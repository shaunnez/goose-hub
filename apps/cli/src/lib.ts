import { STATES } from '../../../core/state-machine/states.js';
import type { StateName } from '../../../core/state-machine/states.js';

const STATE_SET = new Set<string>(STATES);

export type StateResolution = {
  state: StateName;
  conflict: boolean;
  raw: StateName[];
};

export function resolveState(labelNames: string[]): StateResolution {
  const stateLabels = labelNames.filter((l) => STATE_SET.has(l)) as StateName[];

  if (stateLabels.length === 0) {
    return { state: 'factory:triaging', conflict: true, raw: [] };
  }
  if (stateLabels.length === 1) {
    return { state: stateLabels[0] as StateName, conflict: false, raw: stateLabels };
  }
  // archived always wins
  if (stateLabels.includes('factory:archived')) {
    return { state: 'factory:archived', conflict: true, raw: stateLabels };
  }
  // pick most-advanced (highest canonical index)
  const advanced = stateLabels.reduce((a, b) => (STATES.indexOf(a) >= STATES.indexOf(b) ? a : b));
  return { state: advanced, conflict: true, raw: stateLabels };
}

export type GHIssue = {
  number: number;
  title: string;
  labels: Array<{ name: string }>;
};

export type ResolvedIssue = {
  issue: GHIssue;
  resolution: StateResolution;
};

export function groupIssues(resolved: ResolvedIssue[]): {
  byState: Map<StateName, ResolvedIssue[]>;
  conflicts: ResolvedIssue[];
} {
  const byState = new Map<StateName, ResolvedIssue[]>();
  const conflicts: ResolvedIssue[] = [];

  for (const r of resolved) {
    if (r.resolution.conflict && r.resolution.raw.length > 1) {
      conflicts.push(r);
    } else {
      const existing = byState.get(r.resolution.state) ?? [];
      existing.push(r);
      byState.set(r.resolution.state, existing);
    }
  }

  return { byState, conflicts };
}
