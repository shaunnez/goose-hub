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

  it('sortLaneItems sorts newest items first', () => {
    const sorted = sortLaneItems([
      { externalId: '40', createdAt: '2024-01-01T00:00:00.000Z' },
      { externalId: '12', createdAt: '2024-01-03T00:00:00.000Z' },
      { externalId: '7', createdAt: '2024-01-04T00:00:00.000Z' },
      { externalId: '99', createdAt: '2024-01-05T00:00:00.000Z' },
      { externalId: '5', createdAt: '2024-01-02T00:00:00.000Z' },
    ]);
    expect(sorted.map((s) => s.externalId)).toEqual(['99', '7', '12', '5', '40']);
  });

  it('sortLaneItems uses descending issue number as the tie-break', () => {
    const sorted = sortLaneItems([
      { externalId: '30', createdAt: '2024-01-01T00:00:00.000Z' },
      { externalId: '10', createdAt: '2024-01-01T00:00:00.000Z' },
      { externalId: '20', createdAt: '2024-01-01T00:00:00.000Z' },
    ]);
    expect(sorted.map((s) => s.externalId)).toEqual(['30', '20', '10']);
  });

  it('laneForState returns undefined for an unknown state', () => {
    expect(laneForState('factory:nonexistent')).toBeUndefined();
  });
});
