import { describe, expect, it } from 'vitest';
import { LANES, laneForState, sortLaneItems } from './lanes.config';

describe('lanes config', () => {
  it('has 11 lanes with 2 hidden by default', () => {
    expect(LANES.length).toBe(11);
    const hidden = LANES.filter((l) => l.hiddenByDefault);
    expect(hidden.map((l) => l.key)).toEqual(['archive', 'rejected']);
  });

  it('every state in the state machine maps to exactly one lane', () => {
    const seen = new Set<string>();
    for (const lane of LANES) {
      for (const state of lane.states) {
        expect(seen.has(state)).toBe(false);
        seen.add(state);
      }
    }
    // Spot-check a few representative states.
    expect(laneForState('factory:triaging')).toBe('triage');
    expect(laneForState('factory:archived')).toBe('archive');
    expect(laneForState('factory:done')).toBe('done');
  });

  it('sortLaneItems sorts by priority then issue number', () => {
    const sorted = sortLaneItems([
      { externalId: '40', priority: 'medium' },
      { externalId: '12', priority: 'low' },
      { externalId: '7', priority: 'high' },
      { externalId: '99', priority: 'critical' },
      { externalId: '5', priority: 'high' },
    ]);
    expect(sorted.map((s) => s.externalId)).toEqual(['99', '5', '7', '40', '12']);
  });
});
