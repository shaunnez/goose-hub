// Lane config for the Goose Hub Kanban — 11 lanes total, 9 visible by default,
// 2 hidden (Archive, Rejected). Aligns with `docs/PLAN.md` §10.
//
// Pure UI display: changing this file does not affect the state machine, the
// orchestrator, or any workflow.

export interface LaneConfig {
  key: string;
  label: string;
  states: readonly string[];
  hiddenByDefault: boolean;
}

export const LANES: readonly LaneConfig[] = [
  {
    key: 'triage',
    label: 'Triage',
    states: ['factory:triaging', 'factory:accepted'],
    hiddenByDefault: false,
  },
  {
    key: 'discover',
    label: 'Discover',
    states: [
      'factory:grilling',
      'factory:prd-drafting',
      'factory:prd-review',
      'factory:decomposing',
      'factory:issues-created',
    ],
    hiddenByDefault: false,
  },
  {
    // Research and Investigation are both pre-dev information-gathering
    // states; the M2.06 acceptance criteria fix the kanban at 11 lanes
    // (9 visible + 2 hidden), so they share a single lane on the board.
    // The state machine still distinguishes them; only the UI grouping
    // collapses them.
    key: 'investigation',
    label: 'Research / Investigation',
    states: [
      'factory:research-pending',
      'factory:research-complete',
      'factory:investigating',
      'factory:investigation-complete',
    ],
    hiddenByDefault: false,
  },
  {
    key: 'dev',
    label: 'Dev',
    states: ['factory:dev-ready', 'factory:spec-ready', 'factory:in-progress', 'factory:needs-fix', 'factory:qa-failed'],
    hiddenByDefault: false,
  },
  {
    key: 'qa',
    label: 'QA',
    states: ['factory:needs-qa'],
    hiddenByDefault: false,
  },
  {
    key: 'review',
    label: 'Review',
    states: ['factory:needs-review', 'factory:approved', 'factory:merge-conflict'],
    hiddenByDefault: false,
  },
  {
    key: 'retrospective',
    label: 'Retrospective',
    states: ['factory:retrospecting'],
    hiddenByDefault: false,
  },
  {
    key: 'blocked',
    label: 'Blocked',
    states: ['factory:needs-human', 'factory:gate-pending'],
    hiddenByDefault: false,
  },
  {
    key: 'done',
    label: 'Done',
    states: ['factory:done'],
    hiddenByDefault: false,
  },
  {
    key: 'archive',
    label: 'Archive',
    states: ['factory:archived'],
    hiddenByDefault: true,
  },
  {
    key: 'rejected',
    label: 'Rejected',
    states: ['factory:rejected'],
    hiddenByDefault: true,
  },
] as const;

const STATE_TO_LANE = new Map<string, string>();
for (const lane of LANES) {
  for (const state of lane.states) STATE_TO_LANE.set(state, lane.key);
}

export function laneForState(state: string): string | undefined {
  return STATE_TO_LANE.get(state);
}

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

interface SortableItem {
  externalId: string;
  priority: string;
}

/**
 * Order matches the scheduler's eligibility sort: priority desc, then issue
 * number asc.
 */
export function sortLaneItems<T extends SortableItem>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const prDiff = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
    if (prDiff !== 0) return prDiff;
    return Number(a.externalId) - Number(b.externalId);
  });
}
