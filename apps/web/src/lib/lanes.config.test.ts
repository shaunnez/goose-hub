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
    expect(laneForState('factory:merge-conflict')).toBe('review');
  });

  it('sortLaneItems sorts by priority then newest issue number first', () => {
    const sorted = sortLaneItems([
      { externalId: '40', priority: 'medium' },
      { externalId: '12', priority: 'low' },
      { externalId: '7', priority: 'high' },
      { externalId: '99', priority: 'critical' },
      { externalId: '5', priority: 'high' },
    ]);
    expect(sorted.map((s) => s.externalId)).toEqual(['99', '7', '5', '40', '12']);
  });

  it('sortLaneItems treats unknown priority as rank 9 (sorts last)', () => {
    // Line 126: the ?? 9 fallback branch — items with unknown priority rank last
    const sorted = sortLaneItems([
      { externalId: '1', priority: 'high' },
      { externalId: '2', priority: 'unknown-future-priority' },
      { externalId: '3', priority: 'critical' },
    ]);
    // critical(0) < high(1) < unknown(9)
    expect(sorted[0].externalId).toBe('3');
    expect(sorted[1].externalId).toBe('1');
    expect(sorted[2].externalId).toBe('2');
  });

  it('sortLaneItems stable-sorts items with the same priority by externalId descending', () => {
    const sorted = sortLaneItems([
      { externalId: '30', priority: 'medium' },
      { externalId: '10', priority: 'medium' },
      { externalId: '20', priority: 'medium' },
    ]);
    expect(sorted.map((s) => s.externalId)).toEqual(['30', '20', '10']);
  });

  it('laneForState returns undefined for an unknown state', () => {
    expect(laneForState('factory:nonexistent')).toBeUndefined();
  });
});
