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
      { externalId: '40', priority: 'medium', createdAt: '2024-01-01T00:00:00.000Z' },
      { externalId: '12', priority: 'low', createdAt: '2024-01-04T00:00:00.000Z' },
      { externalId: '7', priority: 'high', createdAt: '2024-01-03T00:00:00.000Z' },
      { externalId: '99', priority: 'critical', createdAt: '2024-01-05T00:00:00.000Z' },
      { externalId: '5', priority: 'high', createdAt: '2024-01-02T00:00:00.000Z' },
    ]);
    expect(sorted.map((s) => s.externalId)).toEqual(['99', '12', '7', '5', '40']);
  });

  it('sortLaneItems orders unknown-priority items by recency too', () => {
    const sorted = sortLaneItems([
      { externalId: '1', priority: 'high', createdAt: '2024-01-01T00:00:00.000Z' },
      {
        externalId: '2',
        priority: 'unknown-future-priority',
        createdAt: '2024-01-03T00:00:00.000Z',
      },
      { externalId: '3', priority: 'critical', createdAt: '2024-01-02T00:00:00.000Z' },
    ]);
    expect(sorted.map((s) => s.externalId)).toEqual(['2', '3', '1']);
  });

  it('sortLaneItems breaks createdAt ties by externalId descending', () => {
    const sorted = sortLaneItems([
      { externalId: '30', priority: 'medium', createdAt: '2024-01-01T00:00:00.000Z' },
      { externalId: '10', priority: 'medium', createdAt: '2024-01-01T00:00:00.000Z' },
      { externalId: '20', priority: 'medium', createdAt: '2024-01-01T00:00:00.000Z' },
    ]);
    expect(sorted.map((s) => s.externalId)).toEqual(['30', '20', '10']);
  });

  it('laneForState returns undefined for an unknown state', () => {
    expect(laneForState('factory:nonexistent')).toBeUndefined();
  });
});
