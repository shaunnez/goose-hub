import { describe, expect, it } from 'vitest';
import {
  CODE_ACTIVE_STATES,
  GATE_STATES,
  PRIORITY_BG,
  PRIORITY_BORDER,
  PRIORITY_COLOR,
  STATE_LABEL,
} from './constants';

const ALL_FACTORY_STATES = [
  'factory:triaging',
  'factory:accepted',
  'factory:rejected',
  'factory:framing',
  'factory:grilling',
  'factory:prd-drafting',
  'factory:prd-review',
  'factory:decomposing',
  'factory:issues-created',
  'factory:research-pending',
  'factory:research-complete',
  'factory:investigating',
  'factory:investigation-complete',
  'factory:dev-ready',
  'factory:spec-ready',
  'factory:in-progress',
  'factory:needs-qa',
  'factory:qa-failed',
  'factory:needs-review',
  'factory:needs-fix',
  'factory:approved',
  'factory:merge-conflict',
  'factory:retrospecting',
  'factory:needs-human',
  'factory:done',
  'factory:archived',
  'factory:gate-pending',
];

const PRIORITIES = ['critical', 'high', 'medium', 'low'];

describe('STATE_LABEL', () => {
  it('covers all factory states present in the label map', () => {
    for (const state of ALL_FACTORY_STATES) {
      expect(STATE_LABEL[state], `missing state: ${state}`).toBeDefined();
    }
  });

  it('has no extra unknown states', () => {
    expect(Object.keys(STATE_LABEL)).toHaveLength(ALL_FACTORY_STATES.length);
  });
});

describe('PRIORITY_COLOR', () => {
  it('covers all four priority levels', () => {
    for (const p of PRIORITIES) {
      expect(PRIORITY_COLOR[p], `missing priority: ${p}`).toBeDefined();
    }
  });
});

describe('PRIORITY_BG', () => {
  it('covers all four priority levels', () => {
    for (const p of PRIORITIES) {
      expect(PRIORITY_BG[p], `missing priority: ${p}`).toBeDefined();
    }
  });
});

describe('PRIORITY_BORDER', () => {
  it('covers all four priority levels', () => {
    for (const p of PRIORITIES) {
      expect(PRIORITY_BORDER[p], `missing priority: ${p}`).toBeDefined();
    }
  });
});

describe('CODE_ACTIVE_STATES', () => {
  it('contains only valid factory states', () => {
    for (const state of CODE_ACTIVE_STATES) {
      expect(ALL_FACTORY_STATES, `unknown state in CODE_ACTIVE_STATES: ${state}`).toContain(state);
    }
  });

  it('excludes pre-coding states', () => {
    expect(CODE_ACTIVE_STATES.has('factory:triaging')).toBe(false);
    expect(CODE_ACTIVE_STATES.has('factory:accepted')).toBe(false);
    expect(CODE_ACTIVE_STATES.has('factory:dev-ready')).toBe(false);
  });

  it('includes all post-coding-start states', () => {
    expect(CODE_ACTIVE_STATES.has('factory:in-progress')).toBe(true);
    expect(CODE_ACTIVE_STATES.has('factory:needs-qa')).toBe(true);
    expect(CODE_ACTIVE_STATES.has('factory:needs-review')).toBe(true);
    expect(CODE_ACTIVE_STATES.has('factory:done')).toBe(true);
  });
});

describe('GATE_STATES', () => {
  it('covers exactly three human-gated states', () => {
    expect(Object.keys(GATE_STATES)).toHaveLength(3);
  });

  it('does not include non-gate states', () => {
    expect(GATE_STATES['factory:in-progress']).toBeUndefined();
    expect(GATE_STATES['factory:triaging']).toBeUndefined();
    expect(GATE_STATES['factory:done']).toBeUndefined();
    expect(GATE_STATES['factory:needs-review']).toBeUndefined();
  });

  it('includes known human gate states', () => {
    expect(GATE_STATES['factory:prd-review']).toBeTruthy();
    expect(GATE_STATES['factory:needs-human']).toBeTruthy();
    expect(GATE_STATES['factory:gate-pending']).toBeTruthy();
  });
});
