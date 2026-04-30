import { resolveState as coreResolveState } from '../../../core/state-machine/conflict-resolver.js';
import { STATES } from '../../../core/state-machine/states.js';
import type { StateName } from '../../../core/state-machine/states.js';

const STATE_SET = new Set<string>(STATES);

export type StateResolution = {
  state: StateName;
  conflict: boolean;
  raw: StateName[];
};

export function resolveState(labelNames: string[]): StateResolution {
  const result = coreResolveState(labelNames);
  const raw = labelNames.filter((l) => STATE_SET.has(l)) as StateName[];
  return {
    state: result.state,
    conflict: result.conflicts.length > 0,
    raw,
  };
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
