import { describe, expect, it } from 'vitest';
import { buildSymbolIndexLookupReport } from './report.js';

describe('buildSymbolIndexLookupReport', () => {
  it('summarizes lookup counts, averages, stale rate, and consumer hint counts', () => {
    const report = buildSymbolIndexLookupReport([
      {
        kind: 'symbol-index.lookup',
        payload: {
          identifierCount: 4,
          hintCount: 3,
          stale: false,
          consumerHintCounts: {
            'scout-code-path': 3,
            'scout-dependency': 2,
          },
        },
      },
      {
        kind: 'symbol-index.lookup',
        payload: {
          identifierCount: 2,
          hintCount: 1,
          stale: true,
          consumerHintCounts: {
            'scout-code-path': 1,
            'scout-dependency': 0,
          },
        },
      },
      {
        kind: 'agent.run-started',
        payload: {},
      },
    ]);

    expect(report.lookupCount).toBe(2);
    expect(report.averageIdentifiersPerLookup).toBe(3);
    expect(report.averageHintsPerLookup).toBe(2);
    expect(report.staleRate).toBe(0.5);
    expect(report.hintsByConsumerSkill).toEqual({
      'scout-code-path': { lookupCount: 2, averageHints: 2, totalHints: 4 },
      'scout-dependency': { lookupCount: 2, averageHints: 1, totalHints: 2 },
    });
  });

  it('supports legacy single-consumer lookup events', () => {
    const report = buildSymbolIndexLookupReport([
      {
        kind: 'symbol-index.lookup',
        payload: {
          consumerSkill: 'scout-code-path',
          identifierCount: 1,
          hintCount: 5,
          stale: false,
        },
      },
    ]);

    expect(report.hintsByConsumerSkill).toEqual({
      'scout-code-path': { lookupCount: 1, averageHints: 5, totalHints: 5 },
    });
  });
});
