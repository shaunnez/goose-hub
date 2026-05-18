import { describe, expect, it } from 'vitest';
import { parseDecisionMarkers, parseDecisionMarkersAfter } from './decision-markers.js';

describe('parseDecisionMarkers', () => {
  it('extracts typed live decision markers in source order', () => {
    expect(
      parseDecisionMarkers(
        [
          '[decision] READ: Searching app shell components to find the rendered header owner',
          'ordinary text',
          '[decision] INSIGHT: Sidebar.tsx owns the brand string',
        ].join('\n'),
      ).map(({ kind, summary }) => ({ kind, summary })),
    ).toEqual([
      {
        kind: 'READ',
        summary: 'Searching app shell components to find the rendered header owner',
      },
      { kind: 'INSIGHT', summary: 'Sidebar.tsx owns the brand string' },
    ]);
  });

  it('keeps legacy untyped markers as UNKNOWN', () => {
    expect(parseDecisionMarkers('[decision] a legacy progress marker')).toMatchObject([
      { kind: 'UNKNOWN', summary: 'a legacy progress marker' },
    ]);
  });

  it('keeps invalid typed kinds for caller-side normalization', () => {
    expect(parseDecisionMarkers('[decision] NOT_A_KIND: still visible')).toMatchObject([
      { kind: 'NOT_A_KIND', summary: 'still visible' },
    ]);
  });

  it('ignores lowercase typed-looking markers as legacy text', () => {
    expect(parseDecisionMarkers('[decision] read: lowercase kind')).toMatchObject([
      { kind: 'UNKNOWN', summary: 'read: lowercase kind' },
    ]);
  });
});

describe('parseDecisionMarkersAfter', () => {
  it('returns only markers not already covered by a previous cumulative text offset', () => {
    const first = '[decision] READ: Searching files';
    const cumulative = `${first}\n[decision] INSIGHT: Found the owner`;

    expect(parseDecisionMarkersAfter(cumulative, first.length).map((m) => m.summary)).toEqual([
      'Found the owner',
    ]);
  });
});
