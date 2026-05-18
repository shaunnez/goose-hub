/**
 * Per-workflow expected state-transition sequence. Tracking which transitions
 * have fired lets the `run` orchestrator render a live checklist as the
 * workflow proceeds, and lets the operator see exactly where things stalled
 * when something goes wrong.
 *
 * The sequences are derived from `apps/server/src/shared/dispatch-routing.ts`
 * (label-driven dispatch) and the per-workflow slices.
 */
export type WorkflowKind = 'bug' | 'chore' | 'feature' | 'research';

export interface ChecklistItem {
  /** Short display label for the checklist line. */
  label: string;
  /** The state-label this item is satisfied by (matched on `state.transitioned` payload). */
  state: string;
}

export const CHECKLISTS: Record<WorkflowKind, ChecklistItem[]> = {
  bug: [
    { label: 'Issue triaged', state: 'factory:investigating' },
    { label: 'Investigation complete', state: 'factory:investigation-complete' },
    { label: 'Dev-ready', state: 'factory:dev-ready' },
    { label: 'Dev opened PR', state: 'factory:needs-qa' },
    { label: 'QA passed', state: 'factory:needs-review' },
    { label: 'Review approved', state: 'factory:approved' },
    { label: 'Retro running', state: 'factory:retrospecting' },
    { label: 'Done', state: 'factory:done' },
  ],
  chore: [
    { label: 'Issue triaged → dev-ready', state: 'factory:dev-ready' },
    { label: 'Dev opened PR', state: 'factory:needs-qa' },
    { label: 'QA passed', state: 'factory:needs-review' },
    { label: 'Review approved', state: 'factory:approved' },
    { label: 'Retro running', state: 'factory:retrospecting' },
    { label: 'Done', state: 'factory:done' },
  ],
  feature: [
    { label: 'Issue triaged → grilling', state: 'factory:grilling' },
    { label: 'PRD drafting', state: 'factory:prd-drafting' },
    { label: 'PRD review (human gate)', state: 'factory:prd-review' },
    { label: 'Decomposing into child issues', state: 'factory:decomposing' },
    { label: 'Child issues created', state: 'factory:issues-created' },
    { label: 'Done', state: 'factory:done' },
  ],
  research: [
    { label: 'Research pending', state: 'factory:research-pending' },
    { label: 'Research complete', state: 'factory:research-complete' },
  ],
};

export const TERMINAL_STATES = new Set<string>([
  'factory:done',
  'factory:archived',
  'factory:rejected',
  'factory:needs-human',
  'factory:issues-created',
  'factory:research-complete',
]);

export interface ChecklistProgress {
  workflow: WorkflowKind;
  items: ChecklistItem[];
  ticked: Set<string>;
  failedNode?: string;
  terminalReached: boolean;
}

export function newProgress(workflow: WorkflowKind): ChecklistProgress {
  return {
    workflow,
    items: CHECKLISTS[workflow],
    ticked: new Set(),
    terminalReached: false,
  };
}

/**
 * Observe one event. Returns true iff the event advanced progress
 * (ticked a new checklist item, set failedNode, or reached terminal).
 */
export function observeEvent(progress: ChecklistProgress, event: AgentEventDto): boolean {
  let advanced = false;
  if (event.kind === 'state.transitioned') {
    const to = (event.payload as { to?: string })?.to;
    if (typeof to === 'string') {
      const matched = progress.items.find((i) => i.state === to);
      if (matched && !progress.ticked.has(matched.state)) {
        progress.ticked.add(matched.state);
        advanced = true;
      }
      if (TERMINAL_STATES.has(to) && !progress.terminalReached) {
        progress.terminalReached = true;
        advanced = true;
      }
    }
  }
  if (event.kind === 'agent.run-failed' && !progress.failedNode) {
    const skill = (event.payload as { skill?: string })?.skill ?? 'unknown';
    progress.failedNode = skill;
    advanced = true;
  }
  return advanced;
}

export function renderChecklist(progress: ChecklistProgress): string {
  return progress.items
    .map((item) => {
      const mark = progress.ticked.has(item.state) ? '[x]' : '[ ]';
      return `  ${mark} ${item.label}`;
    })
    .join('\n');
}

/** Subset of the event-stream DTO we depend on, kept loose so tests are simple. */
export interface AgentEventDto {
  id?: string | number;
  kind: string;
  payload?: unknown;
  runId?: string | null;
  workItemId?: string | null;
  ts?: string;
}
