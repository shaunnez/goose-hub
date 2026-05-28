// Maps `factory:*` state labels to the indicator drawn above the agent sprite.
//
// Six glyphs per the M17.03 acceptance criteria:
//   speech    — agent is actively running (writing PRD, drafting spec, dev work)
//   thought   — investigating / pre-thinking
//   question  — gate-pending: agent paused, waiting on human approval
//   coffee    — idle / no active issue at this role
//   bang      — needs-human: blocked on human action
//   check     — done / approved (terminal success)
//
// Pure mapping; no Phaser imports so it can be unit-tested in jsdom.

export type IndicatorKind = 'speech' | 'thought' | 'question' | 'coffee' | 'bang' | 'check';

const STATE_TO_INDICATOR: Readonly<Record<string, IndicatorKind>> = {
  'factory:triaging': 'speech',
  'factory:accepted': 'thought',
  'factory:grounding': 'thought',
  'factory:grilling': 'speech',
  'factory:prd-drafting': 'speech',
  'factory:prd-review': 'thought',
  'factory:decomposing': 'speech',
  'factory:issues-created': 'check',
  'factory:research-pending': 'thought',
  'factory:research-complete': 'check',
  'factory:investigating': 'thought',
  'factory:investigation-complete': 'check',
  'factory:dev-ready': 'thought',
  'factory:spec-ready': 'thought',
  'factory:in-progress': 'speech',
  'factory:needs-fix': 'speech',
  'factory:qa-failed': 'bang',
  'factory:needs-qa': 'speech',
  'factory:needs-review': 'speech',
  'factory:approved': 'check',
  'factory:merge-conflict': 'bang',
  'factory:retrospecting': 'speech',
  'factory:needs-human': 'bang',
  'factory:gate-pending': 'question',
  'factory:done': 'check',
};

export const IDLE_INDICATOR: IndicatorKind = 'coffee';

/**
 * Returns the glyph above a sprite for an active issue's state. When no active
 * issue exists, callers should use `IDLE_INDICATOR` instead.
 */
export function indicatorForState(state: string): IndicatorKind {
  return STATE_TO_INDICATOR[state] ?? IDLE_INDICATOR;
}
