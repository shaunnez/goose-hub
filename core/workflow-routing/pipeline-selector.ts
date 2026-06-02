import type { RouteTier, WorkflowRouteDecision } from './types.js';

export type FixIssuePipeline = 'fix-issue' | 'spec-author-lite' | 'spec-author-full';

const TIER_PIPELINE: Record<RouteTier, FixIssuePipeline> = {
  T0: 'fix-issue',
  T1: 'fix-issue',
  T2: 'spec-author-lite',
  T3: 'spec-author-full',
  T4: 'fix-issue',
};

export function selectFixIssuePipeline(route: WorkflowRouteDecision): FixIssuePipeline {
  return TIER_PIPELINE[route.tier];
}
