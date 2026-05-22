import type { TriageResultDto } from '@/lib/types';
import { describe, expect, it } from 'vitest';
import { getCanonicalTriageSummary, getTriageResultQueryKey } from './TriageResultsSection';

const BASE_TRIAGE: TriageResultDto = {
  priority: 'high',
  type: 'bug',
  candidates: [
    {
      repo: 'shaunnez/goose-hub',
      confidence: 85,
      tier: 1,
      evidence: 'Keyword match in src/lib/',
    },
    {
      repo: 'shaunnez/docs',
      confidence: 55,
      tier: 2,
      evidence: 'Secondary ownership signal',
    },
  ],
  overrideRepo: null,
};

describe('getTriageResultQueryKey', () => {
  it('keeps the canonical overview cache key stable', () => {
    expect(getTriageResultQueryKey('proj', '42')).toEqual(['triage', 'proj', '42']);
  });
});

describe('getCanonicalTriageSummary', () => {
  it('returns priority, type, candidate count, picked repo, and confidence from canonical triage data', () => {
    expect(getCanonicalTriageSummary(BASE_TRIAGE)).toEqual({
      priority: 'high',
      type: 'bug',
      candidateCount: 2,
      pickedRepo: 'shaunnez/goose-hub',
      confidence: 85,
      isOverride: false,
    });
  });

  it('prefers the override repo and marks the summary as overridden', () => {
    expect(
      getCanonicalTriageSummary({
        ...BASE_TRIAGE,
        overrideRepo: 'shaunnez/docs',
      }),
    ).toEqual({
      priority: 'high',
      type: 'bug',
      candidateCount: 2,
      pickedRepo: 'shaunnez/docs',
      confidence: 55,
      isOverride: true,
    });
  });

  it('keeps the override repo visible even if it is not in the candidate list', () => {
    expect(
      getCanonicalTriageSummary({
        ...BASE_TRIAGE,
        overrideRepo: 'shaunnez/ops',
      }),
    ).toEqual({
      priority: 'high',
      type: 'bug',
      candidateCount: 2,
      pickedRepo: 'shaunnez/ops',
      confidence: 85,
      isOverride: true,
    });
  });

  it('returns null repo and confidence when triage produced no candidates', () => {
    expect(
      getCanonicalTriageSummary({
        priority: 'medium',
        type: 'task',
        candidates: [],
        overrideRepo: null,
      }),
    ).toEqual({
      priority: 'medium',
      type: 'task',
      candidateCount: 0,
      pickedRepo: null,
      confidence: null,
      isOverride: false,
    });
  });
});
