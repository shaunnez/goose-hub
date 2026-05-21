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

  it('sortLaneItems sorts newest first', () => {
    const sorted = sortLaneItems([
      { externalId: '100', createdAt: '2024-01-01T00:00:00.000Z' },
      { externalId: '300', createdAt: '2024-01-03T00:00:00.000Z' },
      { externalId: '200', createdAt: '2024-01-02T00:00:00.000Z' },
    ]);
    expect(sorted.map((s) => s.externalId)).toEqual(['300', '200', '100']);
  });

  it('sortLaneItems falls back to issue number descending for equal timestamps', () => {
    const sorted = sortLaneItems([
      { externalId: '10', createdAt: '2024-01-01T00:00:00.000Z' },
      { externalId: '40', createdAt: '2024-01-01T00:00:00.000Z' },
      { externalId: '20', createdAt: '2024-01-01T00:00:00.000Z' },
    ]);
    expect(sorted.map((s) => s.externalId)).toEqual(['40', '20', '10']);
  });

  it('sortLaneItems treats invalid timestamps as oldest', () => {
    const sorted = sortLaneItems([
      { externalId: '1', createdAt: 'not-a-date' },
      { externalId: '3', createdAt: '2024-01-03T00:00:00.000Z' },
      { externalId: '2', createdAt: '2024-01-02T00:00:00.000Z' },
    ]);
    expect(sorted.map((s) => s.externalId)).toEqual(['3', '2', '1']);
  });

  it('laneForState returns undefined for an unknown state', () => {
    expect(laneForState('factory:nonexistent')).toBeUndefined();
  });
});
